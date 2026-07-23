import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MASSAGE_EQUIPMENT_NAMES,
  MASSAGE_EQUIPMENT_SECTIONS,
  isMassageEquipmentName,
} from '../shared/massageEquipmentCategories.js';

test('按摩器材节点与素材库共享完整且不重复的类目名称', () => {
  assert.equal(MASSAGE_EQUIPMENT_NAMES.length, 18);
  assert.equal(new Set(MASSAGE_EQUIPMENT_NAMES).size, MASSAGE_EQUIPMENT_NAMES.length);
  assert.deepEqual(
    MASSAGE_EQUIPMENT_SECTIONS.flatMap(section => section.items),
    MASSAGE_EQUIPMENT_NAMES
  );
  assert.equal(isMassageEquipmentName('足浴盆'), true);
  assert.equal(isMassageEquipmentName('按摩枕'), true);
  assert.equal(isMassageEquipmentName('护眼仪'), true);
  assert.equal(isMassageEquipmentName('未知产品'), false);
});
