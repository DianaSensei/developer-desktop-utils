// "Open tool" shortcuts: user-assigned key combos that open a tool from
// anywhere in the app (GlobalToolShortcuts.tsx listens; Settings → Keyboard
// Shortcuts assigns them). A combo is at most three keys: up to two
// modifiers plus one main key, and needs ⌘/Ctrl, Alt/⌥ or (on macOS) ⌃ —
// except F1–F24, which may stand alone — so it never swallows typing.
//
// Keys are matched by `KeyboardEvent.code` (physical key), because ⌥ changes
// `e.key` on macOS (⌥J → ∆) and Shift changes it everywhere.

import { IS_MAC } from './platform';

/** `mod` is ⌘ on macOS and Ctrl elsewhere; `ctrl` is the separate ⌃ key on macOS only. */
export interface Combo {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** `KeyboardEvent.code` of the main key, e.g. "KeyJ", "Digit3", "F5". */
  code: string;
}

/** Tool id → combo string (see `serializeCombo`). */
export type ToolShortcutMap = Record<string, string>;

export const TOOL_SHORTCUTS_KEY = 'devtool-tool-shortcuts';
export const MAX_KEYS = 3;

const PUNCTUATION: Record<string, string> = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
};
const MODIFIER_CODES = /^(Meta|Control|Alt|Shift)(Left|Right)$|^(OS|AltGraph|CapsLock|Fn)/;

export function isFunctionKey(code: string): boolean {
  return /^F([1-9]|1\d|2[0-4])$/.test(code);
}

/** Main keys a shortcut may use. Arrows, Enter, Space, Tab, Backspace… are
 *  left out on purpose: with modifiers they are all text-editing keys. */
export function isAllowedMainKey(code: string): boolean {
  return /^Key[A-Z]$/.test(code) || /^Digit\d$/.test(code) || isFunctionKey(code) || code in PUNCTUATION;
}

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.test(code);
}

/** The combo an event describes, or null while only modifiers are held. On
 *  Windows/Linux the Win/Super key makes it unusable (the OS owns it). */
export function comboFromEvent(e: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): Combo | null {
  if (!e.code || isModifierCode(e.code)) return null;
  if (!IS_MAC && e.metaKey) return null;
  return {
    mod: IS_MAC ? e.metaKey : e.ctrlKey,
    ctrl: IS_MAC && e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    code: e.code,
  };
}

export function serializeCombo(c: Combo): string {
  return [c.mod && 'Mod', c.ctrl && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift', c.code].filter(Boolean).join('+');
}

export function parseCombo(s: string): Combo | null {
  const parts = s.split('+');
  const code = parts.pop();
  if (!code) return null;
  const mods = new Set(parts);
  if ([...mods].some((m) => !['Mod', 'Ctrl', 'Alt', 'Shift'].includes(m))) return null;
  return { mod: mods.has('Mod'), ctrl: mods.has('Ctrl'), alt: mods.has('Alt'), shift: mods.has('Shift'), code };
}

export function keyCount(c: Combo): number {
  return Number(c.mod) + Number(c.ctrl) + Number(c.alt) + Number(c.shift) + 1;
}

export function codeLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return PUNCTUATION[code] ?? code;
}

/** Keycap labels in the platform's order: ⌃⌥⇧⌘ on macOS, Ctrl+Alt+Shift elsewhere. */
export function comboKeys(c: Combo): string[] {
  const keys = IS_MAC
    ? [c.ctrl && '⌃', c.alt && '⌥', c.shift && '⇧', c.mod && '⌘']
    : [c.mod && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift'];
  return [...keys.filter((k): k is string => !!k), codeLabel(c.code)];
}

export function formatCombo(s: string): string {
  const c = parseCombo(s);
  if (!c) return s;
  return comboKeys(c).join(IS_MAC ? '' : '+');
}

// ---------------------------------------------------------------------------
// Reserved and overlapping combos
// ---------------------------------------------------------------------------

const digits = (prefix: string) => Array.from({ length: 9 }, (_, i) => `${prefix}Digit${i + 1}`);

/** Combos the app or OS needs: assigning one is refused. Value = why. */
const RESERVED: Record<string, string> = Object.fromEntries([
  ...['KeyC', 'KeyV', 'KeyX', 'KeyA', 'KeyZ'].map((k) => [`Mod+${k}`, 'editing'] as const),
  ['Mod+Shift+KeyZ', 'editing'],
  ['Mod+KeyK', 'palette'],
  ['Mod+Backslash', 'tabs'],
  ...digits('Mod+').map((k) => [k, 'tabs'] as const),
  ...digits('Mod+Alt+').map((k) => [k, 'workspaces'] as const),
  ['Mod+Shift+BracketLeft', 'tabs'],
  ['Mod+Shift+BracketRight', 'tabs'],
  ['Mod+KeyW', 'window'],
  ['Mod+KeyQ', 'window'],
  ['Mod+KeyR', 'window'],
  ['Mod+KeyF', 'find'],
  ['Mod+KeyP', 'quickOpen'],
  ...(IS_MAC
    ? [
        ['Mod+KeyH', 'window'], ['Mod+KeyM', 'window'], ['Mod+Backquote', 'window'],
        ['Mod+BracketLeft', 'history'], ['Mod+BracketRight', 'history'],
      ] as const
    : [['Mod+KeyY', 'editing'], ['Alt+F4', 'window']] as const),
]);

export type ReservedReason = 'editing' | 'palette' | 'tabs' | 'workspaces' | 'window' | 'find' | 'quickOpen' | 'history';

/** Shortcuts tools bind while open: allowed, but the global one wins there. */
export const TOOL_COMBOS: Array<{ combo: string; toolId: string; action: string }> = [
  { combo: 'Mod+KeyB', toolId: 'api-client', action: 'New request' },
  { combo: 'Mod+KeyE', toolId: 'api-client', action: 'Environments' },
  { combo: 'Mod+KeyL', toolId: 'api-client', action: 'Focus URL' },
  { combo: 'Mod+Shift+KeyT', toolId: 'api-client', action: 'Reopen closed tab' },
  { combo: 'Mod+KeyS', toolId: 'text-editor', action: 'Save' },
  { combo: 'Mod+Shift+KeyS', toolId: 'text-editor', action: 'Save As' },
  { combo: 'Mod+Alt+KeyS', toolId: 'text-editor', action: 'Save All' },
  { combo: 'Mod+Shift+KeyT', toolId: 'text-editor', action: 'Reopen closed tab' },
  { combo: 'Mod+KeyN', toolId: 'text-editor', action: 'New file' },
  { combo: 'Alt+Shift+KeyF', toolId: 'text-editor', action: 'Format document' },
  { combo: 'Alt+KeyZ', toolId: 'text-editor', action: 'Word wrap' },
  { combo: 'Mod+KeyD', toolId: 'text-editor', action: 'Select next match' },
  { combo: 'Mod+Slash', toolId: 'text-editor', action: 'Toggle comment' },
  { combo: 'Mod+Shift+KeyK', toolId: 'text-editor', action: 'Delete line' },
  { combo: 'Mod+KeyG', toolId: 'text-editor', action: 'Find next' },
  { combo: 'Mod+KeyI', toolId: 'text-editor', action: 'Select line' },
  { combo: 'Mod+Shift+KeyF', toolId: 'text-editor', action: 'Search in files' },
  { combo: 'Mod+Shift+KeyE', toolId: 'text-editor', action: 'Explorer' },
  { combo: 'Mod+Equal', toolId: 'text-editor', action: 'Larger font' },
  { combo: 'Mod+Minus', toolId: 'text-editor', action: 'Smaller font' },
  { combo: 'Mod+Digit0', toolId: 'text-editor', action: 'Reset font size' },
];

export type ComboCheck =
  | { ok: true; overlaps: Array<{ toolId: string; action: string }> }
  | { ok: false; reason: 'noModifier' | 'shiftOnly' | 'tooMany' | 'key' }
  | { ok: false; reason: 'reserved'; detail: ReservedReason };

export function checkCombo(c: Combo): ComboCheck {
  if (!isAllowedMainKey(c.code)) return { ok: false, reason: 'key' };
  if (keyCount(c) > MAX_KEYS) return { ok: false, reason: 'tooMany' };
  const hasRealModifier = c.mod || c.ctrl || c.alt;
  if (!hasRealModifier && !isFunctionKey(c.code)) return { ok: false, reason: c.shift ? 'shiftOnly' : 'noModifier' };
  const s = serializeCombo(c);
  const reserved = RESERVED[s] as ReservedReason | undefined;
  if (reserved) return { ok: false, reason: 'reserved', detail: reserved };
  return { ok: true, overlaps: TOOL_COMBOS.filter((t) => t.combo === s).map(({ toolId, action }) => ({ toolId, action })) };
}

/** Assigns `combo` to `toolId`, taking it away from any other tool. Returns the
 *  new map and the tool that lost it, if any. `combo` null clears. */
export function assignShortcut(
  map: ToolShortcutMap,
  toolId: string,
  combo: string | null,
): { map: ToolShortcutMap; displaced: string | null } {
  const next: ToolShortcutMap = {};
  let displaced: string | null = null;
  for (const [id, c] of Object.entries(map)) {
    if (id === toolId) continue;
    if (combo && c === combo) { displaced = id; continue; }
    next[id] = c;
  }
  if (combo) next[toolId] = combo;
  return { map: next, displaced };
}

/** Combo string → tool id, for the key listener. Ignores invalid entries. */
export function shortcutIndex(map: ToolShortcutMap): Map<string, string> {
  const index = new Map<string, string>();
  for (const [toolId, combo] of Object.entries(map)) {
    const c = typeof combo === 'string' ? parseCombo(combo) : null;
    if (c && checkCombo(c).ok) index.set(serializeCombo(c), toolId);
  }
  return index;
}
