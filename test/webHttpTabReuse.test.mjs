import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON_ROOT = path.join(ROOT, 'server', 'python');
const VENV_PYTHON = process.platform === 'win32'
  ? path.join(PYTHON_ROOT, '.venv', 'Scripts', 'python.exe')
  : path.join(PYTHON_ROOT, '.venv', 'bin', 'python');
const ready = fs.existsSync(VENV_PYTHON);

function runPython(script) {
  const output = execFileSync(VENV_PYTHON, ['-c', script], {
    cwd: PYTHON_ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: PYTHON_ROOT }
  });
  return JSON.parse(output.trim().split('\n').pop());
}

test('项目标签三次请求复用同一 target，只关闭明确重复标签并保留其他页面', {
  skip: ready ? false : '未配置 server/python/.venv'
}, () => {
  const result = runPython(`
import json
import os
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

os.environ['EVAN_RUNTIME_DIR'] = tempfile.mkdtemp(prefix='evan-webhttp-test-')

from ops_cli.webhttp import (
    PROVIDER_ORIGINS,
    WEBHTTP_HASH_KEY,
    WEBHTTP_SESSION_KEY,
    WEBHTTP_WINDOW_PREFIX,
    _provider_page,
    _tagged_provider_url,
)

next_id = 0
next_id_lock = threading.Lock()

def allocate_id():
    global next_id
    with next_id_lock:
        next_id += 1
        return f'target-{next_id}'

def hash_marker(url):
    return dict(parse_qsl(urlparse(url).fragment, keep_blank_values=True)).get(WEBHTTP_HASH_KEY, '')

class FakePage:
    def __init__(self, url='about:blank', *, name='', session='', responsive=True):
        self.url = url
        self.name = name
        self.session = session
        self.responsive = responsive
        self.closed = False
        self.target_id = allocate_id()
        self.navigations = []

    def is_closed(self):
        return self.closed

    def close(self):
        self.closed = True

    def set_default_timeout(self, value):
        pass

    def wait_for_timeout(self, value):
        pass

    def wait_for_load_state(self, state, **kwargs):
        if not self.responsive:
            raise RuntimeError('target crashed')

    def goto(self, url, **kwargs):
        if not self.responsive:
            raise RuntimeError('target crashed')
        self.navigations.append(url)
        self.url = url

    def evaluate(self, script, arg=None):
        if not self.responsive:
            raise RuntimeError('target crashed')
        if 'window.sessionStorage.setItem' in script:
            self.name = arg['windowName']
            self.session = arg['provider']
            parsed = urlparse(self.url)
            pairs = [
                (key, value)
                for key, value in parse_qsl(parsed.fragment, keep_blank_values=True)
                if key != arg['hashKey']
            ]
            pairs.append((arg['hashKey'], arg['provider']))
            self.url = urlunparse(parsed._replace(fragment=urlencode(pairs)))
            return {'windowName': self.name, 'href': self.url}
        if 'sessionMarker' in script:
            return {
                'windowName': self.name,
                'sessionMarker': self.session,
                'hashMarker': hash_marker(self.url),
                'href': self.url,
            }
        if 'window.name ||' in script:
            return self.name
        return None

class FakeContext:
    def __init__(self, pages):
        self.pages = pages
        self.created = 0
        self.creation_lock = threading.Lock()

    def new_page(self):
        with self.creation_lock:
            self.created += 1
            # Expand the race window: without the runtime lock, two callers both
            # observe no project page and create two targets.
            time.sleep(0.03)
            page = FakePage()
            self.pages.append(page)
            return page

def project_pages(context, provider):
    marker = WEBHTTP_WINDOW_PREFIX + provider
    return [
        page for page in context.pages
        if not page.closed and (
            page.name == marker
            or page.session == provider
            or hash_marker(page.url) == provider
        )
    ]

# Three sequential requests + an injected explicit duplicate.
provider = 'gemini-web'
manual_same_host = FakePage(PROVIDER_ORIGINS[provider])
manual_other = FakePage('https://example.com/keep-me#notes')
sequential = FakeContext([manual_same_host, manual_other])
first = _provider_page(sequential, provider)
duplicate = FakePage(
    _tagged_provider_url(provider),
    name=WEBHTTP_WINDOW_PREFIX + provider,
    session=provider,
)
sequential.pages.append(duplicate)
second = _provider_page(sequential, provider)
third = _provider_page(sequential, provider)

# Two simultaneous creators must converge on one target.
concurrent_provider = 'jimeng'
concurrent_manual = FakePage(PROVIDER_ORIGINS[concurrent_provider])
concurrent = FakeContext([concurrent_manual])
with ThreadPoolExecutor(max_workers=2) as pool:
    concurrent_results = list(pool.map(
        lambda _: _provider_page(concurrent, concurrent_provider),
        range(2),
    ))

# A non-responsive fixed tab is replaced once; unrelated tabs survive.
crash_provider = 'google-flow'
crash_manual = FakePage('https://example.net/untouched')
crash = FakeContext([crash_manual])
before_crash = _provider_page(crash, crash_provider)
before_crash.responsive = False
after_crash = _provider_page(crash, crash_provider)

print(json.dumps({
    'sequential': {
        'ids': [first.target_id, second.target_id, third.target_id],
        'project_count': len(project_pages(sequential, provider)),
        'created': sequential.created,
        'duplicate_closed': duplicate.closed,
        'manual_same_preserved': not manual_same_host.closed and manual_same_host.url == PROVIDER_ORIGINS[provider],
        'manual_other_preserved': not manual_other.closed and manual_other.url == 'https://example.com/keep-me#notes',
        'tagged': hash_marker(first.url),
    },
    'concurrent': {
        'ids': [page.target_id for page in concurrent_results],
        'project_count': len(project_pages(concurrent, concurrent_provider)),
        'created': concurrent.created,
        'manual_preserved': not concurrent_manual.closed,
    },
    'crash': {
        'old_id': before_crash.target_id,
        'new_id': after_crash.target_id,
        'old_closed': before_crash.closed,
        'project_count': len(project_pages(crash, crash_provider)),
        'manual_preserved': not crash_manual.closed,
    },
}))
`);

  assert.equal(new Set(result.sequential.ids).size, 1);
  assert.equal(result.sequential.project_count, 1);
  assert.equal(result.sequential.created, 1);
  assert.equal(result.sequential.duplicate_closed, true);
  assert.equal(result.sequential.manual_same_preserved, true);
  assert.equal(result.sequential.manual_other_preserved, true);
  assert.equal(result.sequential.tagged, 'gemini-web');

  assert.equal(new Set(result.concurrent.ids).size, 1);
  assert.equal(result.concurrent.project_count, 1);
  assert.equal(result.concurrent.created, 1);
  assert.equal(result.concurrent.manual_preserved, true);

  assert.notEqual(result.crash.old_id, result.crash.new_id);
  assert.equal(result.crash.old_closed, true);
  assert.equal(result.crash.project_count, 1);
  assert.equal(result.crash.manual_preserved, true);
});

test('HTTP 请求结束仅断开 Playwright，冷启动直接使用带标识的目标 URL', () => {
  const source = fs.readFileSync(path.join(PYTHON_ROOT, 'ops_cli', 'webhttp.py'), 'utf8');
  const connectBlock = source.slice(
    source.indexOf('def _connect('),
    source.indexOf('def _page_window_name(')
  );

  assert.match(connectBlock, /initial_url=_tagged_provider_url/);
  assert.doesNotMatch(connectBlock, /browser\.close\s*\(/);
  assert.doesNotMatch(connectBlock, /page\.close\s*\(/);
});
