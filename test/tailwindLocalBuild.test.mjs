import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('样式不得依赖运行时 CDN——桌面应用断网时界面会整个退化成裸样式', () => {
  assert.doesNotMatch(indexHtml, /cdn\.tailwindcss\.com/);
  assert.match(indexHtml, /src="\/src\/index\.tsx"/);
});

test('Tailwind 作为构建期依赖存在，且锁在 v3', () => {
  const version = pkg.devDependencies?.tailwindcss || pkg.dependencies?.tailwindcss;
  assert.ok(version, 'tailwindcss 必须是项目依赖');
  // Play CDN 提供的是 v3；v4 改了默认色板与间距，换过去会让全局样式漂移。
  assert.match(version, /^[\^~]?3\./);
  assert.ok(pkg.devDependencies?.postcss, 'postcss 必须存在');
  assert.ok(pkg.devDependencies?.autoprefixer, 'autoprefixer 必须存在');
});

test('入口样式表被真正引入，且三层指令齐全', () => {
  const entry = fs.readFileSync(new URL('../src/index.tsx', import.meta.url), 'utf8');
  assert.match(entry, /import '\.\/index\.css';/);
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  // base 是 preflight 重置，缺了会让原生控件的默认样式全部回来。
  assert.match(css, /@tailwind base;/);
  assert.match(css, /@tailwind components;/);
  assert.match(css, /@tailwind utilities;/);
});

test('内容扫描范围覆盖所有写了类名的地方', () => {
  const config = fs.readFileSync(new URL('../tailwind.config.js', import.meta.url), 'utf8');
  assert.match(config, /\.\/index\.html/);
  assert.match(config, /\.\/src\/\*\*\/\*\.\{js,jsx,ts,tsx\}/);
});
