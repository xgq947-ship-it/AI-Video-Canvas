export const MOD: 'Mod';

export interface ShortcutMatch {
    mod?: boolean;
    shift?: boolean;
    alt?: boolean;
    key?: string;
    paste?: boolean;
}

export interface ShortcutItem {
    keys: string[];
    label: string;
    match: ShortcutMatch;
}

export interface ShortcutGroup {
    title: string;
    items: ShortcutItem[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[];
export function allShortcuts(): ShortcutItem[];
export function renderKey(key: string, isMac: boolean): string;
