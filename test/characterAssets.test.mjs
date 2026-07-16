import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCharacterAssetMeta } from '../server/services/characterAssets.js';

test('同名角色复用身份 ID，不同造型建立独立造型 ID', () => {
    const ids = ['character-new', 'look-new'];
    const createId = () => ids.shift();
    const libraryData = [{
        category: 'Character',
        characterName: '苏曼',
        characterId: 'character-existing',
        characterAssetRole: 'identity-face'
    }];

    const result = normalizeCharacterAssetMeta({
        category: 'Character',
        meta: {
            characterName: ' 苏曼 ',
            characterAssetRole: 'look-fullbody',
            lookName: ' 晚宴西装裙 '
        },
        libraryData,
        createId
    });

    assert.equal(result.characterId, 'character-existing');
    assert.equal(result.characterName, '苏曼');
    assert.equal(result.lookId, 'character-new');
    assert.equal(result.lookName, '晚宴西装裙');
});

test('同一角色同名造型复用造型 ID', () => {
    const libraryData = [{
        category: 'Character',
        characterName: '苏曼',
        characterId: 'character-1',
        characterAssetRole: 'look-fullbody',
        lookName: '晚宴西装裙',
        lookId: 'look-1'
    }];

    const result = normalizeCharacterAssetMeta({
        category: 'Character',
        meta: {
            characterName: '苏曼',
            characterAssetRole: 'look-board',
            lookName: '晚宴西装裙'
        },
        libraryData,
        createId: () => 'should-not-be-used'
    });

    assert.equal(result.characterId, 'character-1');
    assert.equal(result.lookId, 'look-1');
});

test('身份库素材不保留造型字段', () => {
    const result = normalizeCharacterAssetMeta({
        category: 'Character',
        meta: {
            characterName: '苏曼',
            characterAssetRole: 'identity-face',
            lookName: '错误造型',
            lookId: 'stale-look'
        },
        libraryData: [],
        createId: () => 'character-1'
    });

    assert.equal(result.characterId, 'character-1');
    assert.equal(result.lookName, undefined);
    assert.equal(result.lookId, undefined);
});
