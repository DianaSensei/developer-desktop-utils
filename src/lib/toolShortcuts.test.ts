import { describe, expect, it, vi } from 'vitest';
import {
  assignShortcut, checkCombo, comboFromEvent, comboKeys, formatCombo, parseCombo, serializeCombo, shortcutIndex,
  type Combo,
} from './toolShortcuts';

// jsdom's user agent is not a Mac: Mod = Ctrl here.
const key = (code: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) =>
  ({ code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
const combo = (s: string) => parseCombo(s) as Combo;

describe('comboFromEvent / serialize / parse', () => {
  it('maps Ctrl to Mod off macOS and round-trips', () => {
    const c = comboFromEvent(key('KeyJ', { ctrlKey: true, shiftKey: true }))!;
    expect(serializeCombo(c)).toBe('Mod+Shift+KeyJ');
    expect(parseCombo('Mod+Shift+KeyJ')).toEqual(c);
  });

  it('ignores modifier-only presses and the Win/Super key', () => {
    expect(comboFromEvent(key('ShiftLeft', { shiftKey: true }))).toBeNull();
    expect(comboFromEvent(key('ControlRight', { ctrlKey: true }))).toBeNull();
    expect(comboFromEvent(key('KeyJ', { metaKey: true }))).toBeNull();
  });

  it('rejects unknown modifier tokens', () => {
    expect(parseCombo('Hyper+KeyJ')).toBeNull();
    expect(parseCombo('')).toBeNull();
  });
});

describe('checkCombo', () => {
  it('accepts up to three keys with a real modifier', () => {
    expect(checkCombo(combo('Alt+KeyJ'))).toEqual({ ok: true, overlaps: [] });
    expect(checkCombo(combo('Mod+Shift+KeyJ'))).toEqual({ ok: true, overlaps: [] });
    expect(checkCombo(combo('Mod+Alt+KeyJ'))).toEqual({ ok: true, overlaps: [] });
  });

  it('refuses a fourth key', () => {
    expect(checkCombo(combo('Mod+Alt+Shift+KeyJ'))).toEqual({ ok: false, reason: 'tooMany' });
  });

  it('refuses combos that would swallow typing; F-keys may stand alone', () => {
    expect(checkCombo(combo('KeyJ'))).toEqual({ ok: false, reason: 'noModifier' });
    expect(checkCombo(combo('Shift+KeyJ'))).toEqual({ ok: false, reason: 'shiftOnly' });
    expect(checkCombo(combo('F7')).ok).toBe(true);
    expect(checkCombo(combo('Shift+F7')).ok).toBe(true);
  });

  it('refuses text-editing keys as the main key', () => {
    for (const code of ['ArrowLeft', 'Enter', 'Space', 'Tab', 'Backspace', 'Escape']) {
      expect(checkCombo(combo(`Mod+${code}`))).toEqual({ ok: false, reason: 'key' });
    }
  });

  it('refuses combos the app or OS already owns', () => {
    expect(checkCombo(combo('Mod+KeyC'))).toEqual({ ok: false, reason: 'reserved', detail: 'editing' });
    expect(checkCombo(combo('Mod+KeyK'))).toEqual({ ok: false, reason: 'reserved', detail: 'palette' });
    expect(checkCombo(combo('Mod+Digit3'))).toEqual({ ok: false, reason: 'reserved', detail: 'tabs' });
    expect(checkCombo(combo('Mod+Alt+Digit3'))).toEqual({ ok: false, reason: 'reserved', detail: 'workspaces' });
    expect(checkCombo(combo('Mod+KeyY'))).toEqual({ ok: false, reason: 'reserved', detail: 'editing' });
    expect(checkCombo(combo('Alt+F4'))).toEqual({ ok: false, reason: 'reserved', detail: 'window' });
  });

  it("reports overlaps with a tool's own shortcut but allows them", () => {
    expect(checkCombo(combo('Mod+KeyS'))).toEqual({ ok: true, overlaps: [{ toolId: 'text-editor', action: 'Save' }] });
    expect(checkCombo(combo('Mod+Shift+KeyT'))).toMatchObject({ ok: true, overlaps: [{ toolId: 'api-client' }, { toolId: 'text-editor' }] });
  });
});

describe('labels', () => {
  it('formats in Windows/Linux order', () => {
    expect(comboKeys(combo('Mod+Alt+Shift+KeyJ'))).toEqual(['Ctrl', 'Alt', 'Shift', 'J']);
    expect(formatCombo('Mod+Shift+Slash')).toBe('Ctrl+Shift+/');
    expect(formatCombo('F12')).toBe('F12');
  });

  it('formats in macOS order with symbols', async () => {
    vi.resetModules();
    vi.doMock('./platform', () => ({ IS_MAC: true }));
    try {
      const mac = await import('./toolShortcuts');
      expect(mac.formatCombo('Mod+Ctrl+Digit1')).toBe('⌃⌘1');
      expect(mac.formatCombo('Mod+Alt+KeyJ')).toBe('⌥⌘J');
      // ⌘ is Mod on macOS; ⌃ is its own key.
      const c = mac.comboFromEvent({ code: 'KeyJ', metaKey: true, ctrlKey: true, altKey: false, shiftKey: false })!;
      expect(mac.serializeCombo(c)).toBe('Mod+Ctrl+KeyJ');
      expect(mac.checkCombo(mac.parseCombo('Ctrl+KeyJ')!).ok).toBe(true);
      expect(mac.checkCombo(mac.parseCombo('Mod+KeyH')!)).toMatchObject({ ok: false, reason: 'reserved' });
    } finally {
      vi.doUnmock('./platform');
      vi.resetModules();
    }
  });
});

describe('assignShortcut / shortcutIndex', () => {
  it('moves a combo off the tool that had it', () => {
    const { map, displaced } = assignShortcut({ json: 'Alt+KeyJ', diff: 'Alt+KeyD' }, 'regex', 'Alt+KeyJ');
    expect(map).toEqual({ diff: 'Alt+KeyD', regex: 'Alt+KeyJ' });
    expect(displaced).toBe('json');
  });

  it('replaces and clears a tool’s own combo', () => {
    expect(assignShortcut({ json: 'Alt+KeyJ' }, 'json', 'Alt+KeyK')).toEqual({ map: { json: 'Alt+KeyK' }, displaced: null });
    expect(assignShortcut({ json: 'Alt+KeyJ' }, 'json', null)).toEqual({ map: {}, displaced: null });
  });

  it('indexes only valid combos', () => {
    const idx = shortcutIndex({ json: 'Alt+KeyJ', bad: 'KeyJ', reserved: 'Mod+KeyC', junk: 42 as unknown as string });
    expect([...idx]).toEqual([['Alt+KeyJ', 'json']]);
  });
});
