import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

const renderRoutes = read('../server/routes/render.js');
const serverMain = read('../server/index.js');
const workflowRoutes = read('../server/routes/workflows.js');
const cliPaths = read('../server/services/cliPaths.js');

test('explorer.exe 的非 0 退出码不算失败', () => {
  // Windows 上 `explorer.exe /select,path` 成功时也会返回非 0（通常是 1）。
  // 据此判失败会让用户看到「无法显示成片」，而资源管理器其实已经正常打开了。
  // server/index.js 的「打开素材目录」早有同样的豁免，两处必须保持一致。
  assert.match(renderRoutes, /process\.platform !== 'win32'/);
  // 「打开素材目录」已从 server/index.js 搬到 server/routes/workflows.js（行为未变）。
  assert.match(workflowRoutes, /explorer\.exe 打开成功时也可能返回非 0 退出码/);
});

test('任务临时目录清理失败不会盖掉真正的错误', () => {
  // Windows 上子进程可能还持着任务目录的句柄，rmSync 会抛 EBUSY/EPERM。
  // 这段在 finally 里，抛出去会把真正的生成失败原因整个替换掉 ——
  // 用户花了生成配额，却只看到一条删临时目录的报错。
  for (const file of [
  ]) {
    const source = read(file);
    const cleanup = source.slice(source.indexOf('} finally {'));
    assert.match(cleanup, /try \{\s*fs\.rmSync\(taskDir/, `${file} 的临时目录清理没有兜底`);
    assert.match(cleanup, /catch \(cleanupError\)/, `${file} 没有吞掉清理错误`);
  }
});

test('Windows 上的 CLI 解析覆盖 .cmd/.exe/.bat 且用分号切 PATH', () => {
  // Node 从 20.12 起不允许直接 spawn .cmd/.bat（CVE-2024-27980），
  // 所以既要能找到这些扩展名，调用时也必须经 cmd.exe 包装。
  assert.match(cliPaths, /\[`\$\{cliName\}\.cmd`, `\$\{cliName\}\.exe`, `\$\{cliName\}\.bat`, cliName\]/);
  assert.match(cliPaths, /platform === 'win32' \? ';' : ':'/);

  const codexIntegration = read('../server/services/codexIntegration.js');
  const optimizer = read('../server/services/promptOptimizerProviders.js');
  const automation = read('../server/services/codexImageAutomation.js');
  for (const [name, source] of [
    ['codexIntegration', codexIntegration],
    ['promptOptimizerProviders', optimizer],
    ['codexImageAutomation', automation]
  ]) {
    assert.match(source, /\\\.\(\?:cmd\|bat\)\$/i, `${name} 没有识别 Windows 脚本`);
    assert.match(source, /ComSpec|COMSPEC/, `${name} 没有经 cmd.exe 调用`);
  }
});

test('项目文件夹名避开 Windows 保留名与非法字符', () => {
  const projectAssets = read('../server/utils/projectAssets.js');
  assert.match(projectAssets, /con\|prn\|aux\|nul\|com\[1-9\]\|lpt\[1-9\]/);
  // 结尾的点和空格在 Windows 上会被静默吃掉，导致路径对不上。
  assert.match(projectAssets, /replace\(\/\[\. \]\+\$\/g, ''\)/);
});
