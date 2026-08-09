import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/components/ProjectSidebar.tsx', import.meta.url), 'utf8');

test('侧边栏素材和节点使用紧凑缩略图，并以可读字号显示两行名称', () => {
    assert.ok((source.match(/h-10 w-10/g) || []).length >= 2);
    assert.ok((source.match(/line-clamp-2 break-words text-\[13px\] leading-\[17px\]/g) || []).length >= 2);
    assert.doesNotMatch(source, /min-w-0 flex-1 truncate text-sm/);
});
