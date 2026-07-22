import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('开发服务端口冲突时整组退出，不产生隐藏的重复画布进程', () => {
    assert.match(pkg.scripts.dev, /--kill-others-on-fail/);
    assert.match(pkg.scripts.dev, /vite --strictPort/);
});
