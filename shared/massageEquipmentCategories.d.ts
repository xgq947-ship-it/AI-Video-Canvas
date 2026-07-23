export const MASSAGE_EQUIPMENT_CATEGORY: 'Massage Equipment';
export const MASSAGE_EQUIPMENT_SECTIONS: ReadonlyArray<{
  title: string;
  items: ReadonlyArray<string>;
}>;
export const MASSAGE_EQUIPMENT_NAMES: ReadonlyArray<string>;
export function isMassageEquipmentName(name: string): boolean;
