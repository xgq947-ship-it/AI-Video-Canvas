import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importLocalProject } from '../server/services/projectImport.js';

function makeEnvironment() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-project-import-'));
    const source = path.join(root, 'source-project');
    const projectsDir = path.join(root, 'app-data', 'library', 'projects');
    const workflowsDir = path.join(root, 'app-data', 'library', 'workflows');
    fs.mkdirSync(path.join(source, 'images'), { recursive: true });
    fs.mkdirSync(path.join(source, 'videos'), { recursive: true });
    fs.writeFileSync(path.join(source, 'images', 'frame.png'), 'image');
    fs.writeFileSync(path.join(source, 'videos', 'clip.mp4'), 'video');
    return { root, source, projectsDir, workflowsDir };
}

test('本地项目导入会复制项目、注册工作流并重写项目媒体路径', t => {
    const env = makeEnvironment();
    t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));

    const sourceWorkflow = {
        id: 'local-project-source',
        title: '参考项目',
        projectDirName: '旧项目目录',
        projectPath: path.join(env.root, 'source-project'),
        nodes: [{
            id: 'image-node',
            resultUrl: '/library/projects/%E6%97%A7%E9%A1%B9%E7%9B%AE%E7%9B%AE%E5%BD%95/images/frame.png'
        }],
        groups: [],
        viewport: { x: 12, y: 34, zoom: 0.8 }
    };
    fs.writeFileSync(path.join(env.source, 'project.json'), JSON.stringify(sourceWorkflow, null, 2));
    fs.mkdirSync(env.workflowsDir, { recursive: true });
    fs.writeFileSync(
        path.join(env.workflowsDir, `${sourceWorkflow.id}.json`),
        JSON.stringify({ id: sourceWorkflow.id, title: '另一个已注册项目' })
    );

    const result = importLocalProject(env.source, {
        projectsDir: env.projectsDir,
        workflowsDir: env.workflowsDir
    });
    const imported = result.workflow;
    const destination = path.join(env.projectsDir, imported.projectDirName);

    assert.equal(result.alreadyImported, false);
    assert.notEqual(imported.id, sourceWorkflow.id, '导入副本不能复用可能已存在的工作流 ID');
    assert.equal(imported.projectPath, undefined);
    assert.equal(imported.projectStorage, undefined);
    assert.match(imported.nodes[0].resultUrl, new RegExp(`/library/projects/${encodeURIComponent(imported.projectDirName)}/images/frame\\.png`));
    assert.equal(fs.readFileSync(path.join(destination, 'images', 'frame.png'), 'utf8'), 'image');
    assert.equal(fs.readFileSync(path.join(destination, 'videos', 'clip.mp4'), 'utf8'), 'video');
    assert.deepEqual(
        JSON.parse(fs.readFileSync(path.join(destination, 'project.json'), 'utf8')),
        imported
    );
    assert.deepEqual(
        JSON.parse(fs.readFileSync(path.join(env.workflowsDir, `${imported.id}.json`), 'utf8')),
        imported
    );

    const original = JSON.parse(fs.readFileSync(path.join(env.source, 'project.json'), 'utf8'));
    assert.deepEqual(original, sourceWorkflow, '导入不能修改原项目');
});

test('重复选择同一个已注册本地项目时返回原工作流，不再次复制', t => {
    const env = makeEnvironment();
    t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(env.source, 'project.json'), JSON.stringify({
        id: 'already-imported',
        title: '已注册项目',
        projectDirName: '已注册项目',
        nodes: [],
        groups: [],
        viewport: { x: 0, y: 0, zoom: 1 }
    }));

    fs.mkdirSync(path.join(env.projectsDir, '已注册项目'), { recursive: true });
    fs.mkdirSync(env.workflowsDir, { recursive: true });
    fs.writeFileSync(
        path.join(env.workflowsDir, 'already-imported.json'),
        JSON.stringify({
            id: 'already-imported',
            title: '已注册项目',
            projectDirName: '已注册项目',
            projectPath: env.source,
            nodes: [{ id: 'existing-node' }],
            groups: [],
            viewport: { x: 0, y: 0, zoom: 1 }
        })
    );

    const result = importLocalProject(env.source, {
        projectsDir: env.projectsDir,
        workflowsDir: env.workflowsDir
    });
    assert.equal(result.alreadyImported, true);
    assert.equal(result.workflow.nodes[0].id, 'existing-node');
    assert.deepEqual(fs.readdirSync(env.projectsDir), ['已注册项目']);
});

test('选择的文件夹缺少 project.json 时拒绝导入', t => {
    const env = makeEnvironment();
    t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));

    assert.throws(
        () => importLocalProject(env.source, {
            projectsDir: env.projectsDir,
            workflowsDir: env.workflowsDir
        }),
        error => error.code === 'PROJECT_MANIFEST_MISSING' && error.message.includes('project.json')
    );
    assert.equal(fs.existsSync(env.projectsDir), false);
    assert.equal(fs.existsSync(env.workflowsDir), false);
});
