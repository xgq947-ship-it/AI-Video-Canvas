import assert from 'node:assert/strict';
import test from 'node:test';

import {
    decodeProcessOutput,
    withUtf8PythonEnvironment
} from '../server/utils/processOutput.js';
import { opsEnvironment } from '../server/services/opsCliRunner.js';

test('跨数据块拼接 UTF-8 中文，不产生替换字符', () => {
    const bytes = Buffer.from('即梦生图失败：参数设置浮层未关闭', 'utf8');
    const chunks = [
        bytes.subarray(0, 1),
        bytes.subarray(1, 5),
        bytes.subarray(5, 8),
        bytes.subarray(8)
    ];

    const decoded = decodeProcessOutput(chunks);
    assert.equal(decoded, '即梦生图失败：参数设置浮层未关闭');
    assert.doesNotMatch(decoded, /�/);
});

test('Windows GB18030 子进程输出可恢复为中文', () => {
    // “即梦生图失败”的 GBK/GB18030 字节；旧实现按 UTF-8 解码会显示 ����。
    const gb18030 = Buffer.from('bcb4c3cec9facdbccaa7b0dc', 'hex');
    assert.equal(decodeProcessOutput(gb18030), '即梦生图失败');
});

test('Windows UTF-16LE BOM 输出可恢复为中文', () => {
    const body = Buffer.from('Flow 登录失效', 'utf16le');
    assert.equal(
        decodeProcessOutput([Buffer.from([0xff, 0xfe]), body]),
        'Flow 登录失效'
    );
});

test('Python 与冻结 Ops CLI 始终收到 UTF-8 环境', () => {
    const forced = withUtf8PythonEnvironment({ EXISTING: 'keep' });
    assert.equal(forced.EXISTING, 'keep');
    assert.equal(forced.PYTHONUTF8, '1');
    assert.equal(forced.PYTHONIOENCODING, 'utf-8');
    assert.equal(forced.PYTHONLEGACYWINDOWSSTDIO, '0');

    const environment = opsEnvironment();
    assert.equal(environment.PYTHONUTF8, '1');
    assert.equal(environment.PYTHONIOENCODING, 'utf-8');
    assert.equal(environment.PYTHONLEGACYWINDOWSSTDIO, '0');
});
