import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    deleteWorkflowAssetDirs,
    ensureProjectFolder,
    renameWorkflowAssetDirs,
    sanitizeProjectDirName
} from '../server/utils/projectAssets.js';

const makeEnvironment = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-project-location-'));
    const projectsDir = path.join(root, 'app-data', 'projects');
    const selectedParent = path.join(root, 'selected');
    const imagesDir = path.join(root, 'app-data', 'images');
    const videosDir = path.join(root, 'app-data', 'videos');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(selectedParent, { recursive: true });
    return { root, projectsDir, selectedParent, imagesDir, videosDir };
};

test('custom project location creates a platform-native directory mapping', t => {
    const env = makeEnvironment();
    t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
    const target = path.join(env.selectedParent, '桌面项目');
    const workflow = {
        id: 'workflow-custom-location',
        title: '桌面项目',
        projectDirName: '桌面项目',
        projectPath: target,
        nodes: [{
            resultUrl: '/library/projects/%E6%A1%8C%E9%9D%A2%E9%A1%B9%E7%9B%AE/images/result.png'
        }]
    };

    const root = ensureProjectFolder(workflow, { projectsDir: env.projectsDir }, { exactName: true });
    assert.equal(root, target);
    for (const type of ['images', 'videos', 'audio']) {
        assert.equal(fs.statSync(path.join(target, type)).isDirectory(), true);
    }
    assert.equal(
        fs.realpathSync(path.join(env.projectsDir, '桌面项目')),
        fs.realpathSync(target)
    );

    fs.writeFileSync(path.join(target, 'project.json'), JSON.stringify({
        id: workflow.id,
        title: workflow.title
    }));

    const renamed = renameWorkflowAssetDirs(workflow, '桌面项目新版', env);
    assert.equal(renamed.changed, true);
    assert.equal(workflow.projectPath, target, 'renaming keeps the user-selected physical location stable');
    assert.equal(
        fs.realpathSync(path.join(env.projectsDir, '桌面项目新版')),
        fs.realpathSync(target)
    );
    assert.match(workflow.nodes[0].resultUrl, /%E6%A1%8C%E9%9D%A2%E9%A1%B9%E7%9B%AE%E6%96%B0%E7%89%88/);

    deleteWorkflowAssetDirs(workflow, env);
    assert.equal(fs.existsSync(target), false);
    assert.throws(() => fs.lstatSync(path.join(env.projectsDir, '桌面项目新版')), { code: 'ENOENT' });
});

test('custom project delete preserves a folder without the matching project marker', t => {
    const env = makeEnvironment();
    t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
    const target = path.join(env.selectedParent, '受保护项目');
    const workflow = {
        id: 'expected-id',
        title: '受保护项目',
        projectDirName: '受保护项目',
        projectPath: target
    };
    ensureProjectFolder(workflow, { projectsDir: env.projectsDir });
    fs.writeFileSync(path.join(target, 'project.json'), JSON.stringify({ id: 'different-id' }));

    deleteWorkflowAssetDirs(workflow, env);
    assert.equal(fs.existsSync(target), true);
    assert.throws(() => fs.lstatSync(path.join(env.projectsDir, '受保护项目')), { code: 'ENOENT' });
});

test('missing custom project folder reports an error instead of recreating an empty project', t => {
    const env = makeEnvironment();
    t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
    const target = path.join(env.selectedParent, '移动后的项目');
    const workflow = {
        id: 'missing-project',
        title: '移动后的项目',
        projectDirName: '移动后的项目',
        projectPath: target
    };
    ensureProjectFolder(workflow, { projectsDir: env.projectsDir });
    fs.rmSync(target, { recursive: true, force: true });

    assert.throws(
        () => ensureProjectFolder(workflow, { projectsDir: env.projectsDir }),
        error => error.code === 'PROJECT_LOCATION_MISSING'
    );
    assert.equal(fs.existsSync(target), false);
});

test('Windows reserved device names are made safe on every platform', () => {
    assert.equal(sanitizeProjectDirName('CON'), 'CON_project');
    assert.equal(sanitizeProjectDirName('lpt1.txt'), 'lpt1.txt_project');
    assert.equal(sanitizeProjectDirName('正常项目'), '正常项目');
});

test('desktop project API creates, serves, saves and deletes a custom-location project', async t => {
    const env = makeEnvironment();
    t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
    const desktopToken = 'project-location-test-token';
    const child = spawn(process.execPath, [
        '--input-type=module',
        '--eval',
        "import('./server/index.js').then(({ startBackend }) => startBackend({ port: 0 }))"
    ], {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: {
            ...process.env,
            NODE_ENV: 'test',
            EVAN_DESKTOP: '1',
            EVAN_DESKTOP_TOKEN: desktopToken,
            EVAN_DATA_DIR: path.join(env.root, 'desktop-data')
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    t.after(() => {
        if (!child.killed) child.kill('SIGTERM');
    });

    const origin = await new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => reject(new Error(`backend startup timed out:\n${output}`)), 10_000);
        const inspect = chunk => {
            output += chunk.toString();
            const match = output.match(/Backend server running on (http:\/\/127\.0\.0\.1:\d+)/);
            if (!match) return;
            clearTimeout(timeout);
            resolve(match[1]);
        };
        child.stdout.on('data', inspect);
        child.stderr.on('data', inspect);
        child.once('exit', code => {
            clearTimeout(timeout);
            reject(new Error(`backend exited before ready (${code}):\n${output}`));
        });
    });

    const unauthorized = await fetch(`${origin}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '未授权项目', parentDirectory: env.selectedParent })
    });
    assert.equal(unauthorized.status, 403);

    const createdResponse = await fetch(`${origin}/api/projects`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Evan-Desktop-Token': desktopToken
        },
        body: JSON.stringify({ title: '桌面项目', parentDirectory: env.selectedParent })
    });
    const created = await createdResponse.json();
    assert.equal(createdResponse.status, 201, JSON.stringify(created));
    const projectRoot = path.join(env.selectedParent, '桌面项目');
    assert.equal(created.projectPath, projectRoot);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(projectRoot, 'project.json'), 'utf8')).nodes, []);

    fs.writeFileSync(path.join(projectRoot, 'images', 'served.txt'), 'external-project-file');
    const served = await fetch(`${origin}/library/projects/%E6%A1%8C%E9%9D%A2%E9%A1%B9%E7%9B%AE/images/served.txt`);
    assert.equal(served.status, 200);
    assert.equal(await served.text(), 'external-project-file');

    const savedResponse = await fetch(`${origin}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id: created.id,
            title: created.title,
            nodes: [{ id: 'node-1', type: 'Text', x: 0, y: 0 }, {
                id: 'detail-remix-1',
                type: 'Detail Page Remix',
                x: 400,
                y: 0,
                parentIds: ['competitor-1', 'own-1', 'person-1'],
                inputPortByParentId: {
                    'competitor-1': 'competitor-detail',
                    'own-1': 'own-detail',
                    'person-1': 'character-reference'
                },
                detailRemix: {
                    schemaVersion: 1,
                    status: 'plates-ready',
                    inputRefs: {
                        competitorDetailNodeIds: ['competitor-1'],
                        ownDetailNodeIds: ['own-1'],
                        characterReference: { enabled: false, nodeIds: ['person-1'] },
                        productNodeIds: []
                    },
                    analysis: { ownSellingPoints: [{ id: 'sp-1', title: '真实卖点' }], pages: [] }
                }
            }],
            groups: [],
            viewport: { x: 0, y: 0, zoom: 1 }
        })
    });
    assert.equal(savedResponse.status, 200);
    const projectCopy = JSON.parse(fs.readFileSync(path.join(projectRoot, 'project.json'), 'utf8'));
    assert.equal(projectCopy.nodes[0].id, 'node-1');
    assert.deepEqual(projectCopy.nodes[1].detailRemix.inputRefs.characterReference, {
        enabled: false,
        nodeIds: ['person-1']
    });
    assert.equal(projectCopy.nodes[1].detailRemix.analysis.ownSellingPoints[0].title, '真实卖点');
    assert.equal(projectCopy.projectPath, projectRoot);

    const deleted = await fetch(`${origin}/api/workflows/${created.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.equal(fs.existsSync(projectRoot), false);
});
