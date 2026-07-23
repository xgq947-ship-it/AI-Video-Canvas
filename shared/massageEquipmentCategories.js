export const MASSAGE_EQUIPMENT_CATEGORY = 'Massage Equipment';

export const MASSAGE_EQUIPMENT_SECTIONS = Object.freeze([
  { title: '足部腿部', items: Object.freeze(['足浴盆', '足疗机', '膝盖按摩器']) },
  { title: '头眼颈肩', items: Object.freeze(['护眼仪', '按摩枕', '按摩披肩', '护颈仪', '头部按摩器']) },
  { title: '腰腹坐卧', items: Object.freeze(['按摩靠垫', '按摩椅', '按摩床垫', '腰腹按摩器', '揉腹仪', '按摩座垫']) },
  { title: '手持理疗', items: Object.freeze(['筋膜枪', '按摩棒', '刮痧仪', '手部按摩器']) },
]);

export const MASSAGE_EQUIPMENT_NAMES = Object.freeze(
  MASSAGE_EQUIPMENT_SECTIONS.flatMap(section => section.items)
);

export const isMassageEquipmentName = name => MASSAGE_EQUIPMENT_NAMES.includes(name);
