/**
 * shortcutRegistry.js
 *
 * 快捷键的展示清单 —— 面板渲染它，测试拿它跟真实的键盘处理逻辑对账。
 *
 * 为什么单独放一份而不是让处理逻辑直接由它驱动：useKeyboardShortcuts 里的
 * if 链掺了不少条件（Shift 区分成组/解组、选中边优先于选中节点、空格平移的
 * keyup 复位等），改成表驱动会把这些细节挤进配置里，得不偿失。所以这里只做
 * 「说明书」，另外用 test/shortcutRegistry.test.mjs 保证说明书和实现不脱节：
 * 处理逻辑里出现的每个绑定都必须在这份清单里有条目。
 *
 * `match` 是给测试用的机器可读描述，不参与运行时。
 */

/** 平台无关的修饰键记号；渲染时按平台替换成 ⌘ 或 Ctrl。 */
export const MOD = 'Mod';

export const SHORTCUT_GROUPS = [
    {
        title: '编辑',
        items: [
            { keys: [MOD, 'Z'], label: '撤销', match: { mod: true, key: 'z' } },
            { keys: [MOD, 'Shift', 'Z'], label: '重做', match: { mod: true, key: 'z', shift: true } },
            { keys: [MOD, 'Y'], label: '重做', match: { mod: true, key: 'y' } },
            { keys: [MOD, 'C'], label: '复制选中节点', match: { mod: true, key: 'c' } },
            { keys: [MOD, 'V'], label: '粘贴（也支持直接粘贴图片）', match: { paste: true } },
            { keys: [MOD, 'D'], label: '创建副本', match: { mod: true, key: 'd' } },
            { keys: ['Delete'], label: '删除选中节点或连线', match: { key: 'delete' } },
            { keys: ['Esc'], label: '取消选择', match: { key: 'escape' } },
        ],
    },
    {
        title: '节点与连线',
        items: [
            { keys: ['Tab'], label: '打开新建节点菜单', match: { key: 'tab' } },
            { keys: [MOD, 'L'], label: '连接选中节点', match: { mod: true, key: 'l' } },
            { keys: [MOD, 'G'], label: '成组', match: { mod: true, key: 'g' } },
            { keys: [MOD, 'Shift', 'G'], label: '解组', match: { mod: true, key: 'g', shift: true } },
            { keys: [MOD, 'Enter'], label: '生成选中节点', match: { mod: true, key: 'enter' } },
            { keys: ['Alt', 'Shift', 'F'], label: '自动排列画布', match: { alt: true, shift: true, key: 'f' } },
        ],
    },
    {
        title: '视图',
        items: [
            { keys: [MOD, '+'], label: '放大', match: { mod: true, key: '+' } },
            { keys: [MOD, '-'], label: '缩小', match: { mod: true, key: '-' } },
            { keys: [MOD, '0'], label: '缩放到适合窗口', match: { mod: true, key: '0' } },
            { keys: ['空格', '拖动'], label: '平移画布', match: { key: 'space' } },
            { keys: ['?'], label: '打开/关闭本面板', match: { key: '?' } },
        ],
    },
];

/** 面板里所有条目的扁平列表。 */
export const allShortcuts = () => SHORTCUT_GROUPS.flatMap(group => group.items);

/**
 * 把 MOD 记号换成当前平台的写法。
 * @param {string} key
 * @param {boolean} isMac
 */
export const renderKey = (key, isMac) => (key === MOD ? (isMac ? '⌘' : 'Ctrl') : key);
