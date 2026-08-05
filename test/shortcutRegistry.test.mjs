/**
 * 快捷键说明书与实现的对账测试。
 *
 * 面板内容来自 utils/shortcutRegistry.js，而真正生效的绑定在
 * useKeyboardShortcuts.ts 的 if 链里。两边分开写就一定会慢慢对不上，
 * 所以这里逐条核对：实现里出现的每个绑定，说明书里都得有。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { SHORTCUT_GROUPS, allShortcuts, renderKey, MOD } from '../src/utils/shortcutRegistry.js';

const HOOK = fs.readFileSync(new URL('../src/hooks/useKeyboardShortcuts.ts', import.meta.url), 'utf8');
const HISTORY = fs.readFileSync(new URL('../src/utils/keyboardShortcuts.js', import.meta.url), 'utf8');
const MODAL = fs.readFileSync(new URL('../src/components/modals/ShortcutHelpModal.tsx', import.meta.url), 'utf8');

const items = allShortcuts();
const hasMatch = predicate => items.some(item => predicate(item.match));

test('说明书条目本身是完整的', () => {
    assert.ok(items.length >= 15, `快捷键条目只有 ${items.length} 条，明显不全`);
    for (const item of items) {
        assert.ok(item.keys.length > 0, `${item.label} 缺少按键`);
        assert.ok(item.label.trim().length > 0, '存在没有说明文字的条目');
        assert.ok(item.match && typeof item.match === 'object', `${item.label} 缺少 match 描述`);
    }
});

test('实现里的每个 mod+字母 绑定都在说明书里', () => {
    // 抓 `mod && key === 'x'` 形式的绑定
    const bindings = [...HOOK.matchAll(/mod && key === '([a-z0-9])'/g)].map(match => match[1]);
    assert.ok(bindings.length >= 5, `没抓到足够的 mod 绑定（${bindings.length}），正则可能已失效`);
    for (const key of new Set(bindings)) {
        assert.ok(
            hasMatch(match => match.mod && match.key === key),
            `实现里有 Mod+${key.toUpperCase()}，但快捷键面板没写`
        );
    }
});

test('实现里的 mod+符号 绑定都在说明书里', () => {
    const bindings = [...HOOK.matchAll(/mod && \(?e\.key === '([^a-z ]|Enter)'/g)].map(match => match[1]);
    for (const key of new Set(bindings)) {
        const normalized = key.toLowerCase();
        assert.ok(
            hasMatch(match => match.mod && match.key === normalized),
            `实现里有 Mod+${key}，但快捷键面板没写`
        );
    }
});

test('撤销/重做以 canvasHistoryShortcut 为准，说明书三种写法都覆盖', () => {
    // 实现把撤销重做委托给 canvasHistoryShortcut，正则抓不到，改为核对那个函数
    assert.match(HISTORY, /key === 'z' && !event\?\.shiftKey/);
    assert.match(HISTORY, /key === 'y' \|\| \(key === 'z' && event\?\.shiftKey\)/);
    assert.ok(hasMatch(m => m.mod && m.key === 'z' && !m.shift), '缺少 Mod+Z 撤销');
    assert.ok(hasMatch(m => m.mod && m.key === 'z' && m.shift), '缺少 Mod+Shift+Z 重做');
    assert.ok(hasMatch(m => m.mod && m.key === 'y'), '缺少 Mod+Y 重做');
});

test('非 mod 的特殊键绑定都在说明书里', () => {
    const expectations = [
        { present: /e\.key === 'Tab'/, key: 'tab', name: 'Tab' },
        { present: /e\.key === 'Delete' \|\| e\.key === 'Backspace'/, key: 'delete', name: 'Delete' },
        { present: /e\.key === 'Escape'/, key: 'escape', name: 'Esc' },
        { present: /e\.code === 'Space'/, key: 'space', name: '空格' },
        { present: /e\.key === '\?'/, key: '?', name: '?' },
    ];
    for (const { present, key, name } of expectations) {
        assert.match(HOOK, present, `实现里应当有 ${name} 绑定`);
        assert.ok(hasMatch(match => match.key === key), `实现里有 ${name}，但快捷键面板没写`);
    }
});

test('Alt+Shift+F 自动排列在说明书里', () => {
    assert.match(HOOK, /e\.altKey && e\.shiftKey && key === 'f'/);
    assert.ok(hasMatch(match => match.alt && match.shift && match.key === 'f'));
});

test('粘贴走 paste 事件而非 keydown，说明书仍需列出', () => {
    assert.match(HOOK, /addEventListener\('paste', handlePasteEvent\)/);
    assert.ok(hasMatch(match => match.paste), '粘贴没有出现在快捷键面板里');
});

test('Mod 记号按平台渲染', () => {
    assert.equal(renderKey(MOD, true), '⌘');
    assert.equal(renderKey(MOD, false), 'Ctrl');
    assert.equal(renderKey('Tab', true), 'Tab', '非修饰键不应被改写');
});

test('面板由 registry 驱动，没有把快捷键写死在 JSX 里', () => {
    assert.match(MODAL, /SHORTCUT_GROUPS/);
    assert.match(MODAL, /renderKey\(key, isMac\)/);
});

test('分组标题不重复，条目在组内不重复', () => {
    const titles = SHORTCUT_GROUPS.map(group => group.title);
    assert.equal(new Set(titles).size, titles.length, '存在重复的分组标题');
    for (const group of SHORTCUT_GROUPS) {
        const keys = group.items.map(item => `${item.keys.join('+')}|${item.label}`);
        assert.equal(new Set(keys).size, keys.length, `${group.title} 组内有重复条目`);
    }
});
