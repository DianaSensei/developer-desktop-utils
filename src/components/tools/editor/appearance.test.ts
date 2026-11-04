import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, MAX_FONT_SIZE, MIN_FONT_SIZE, clampFontSize, fontFamilyFor, normalizeAppearance } from './appearance';

describe('editor appearance', () => {
  it('defaults to the IntelliJ look with JetBrains Mono and SQL hints', () => {
    expect(normalizeAppearance(null)).toEqual({ theme: 'intellij', font: 'jetbrains-mono', fontSize: 13, hints: true });
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
  });

  it('keeps valid saved values and drops unknown ones', () => {
    expect(normalizeAppearance({ theme: 'vscode', font: 'fira-code', fontSize: 15, hints: false }))
      .toEqual({ theme: 'vscode', font: 'fira-code', fontSize: 15, hints: false });
    expect(normalizeAppearance({ theme: 'solarized', font: 'comic', fontSize: '15', hints: 'yes' })).toEqual(DEFAULT_APPEARANCE);
  });

  it('clamps the font size', () => {
    expect(clampFontSize(2)).toBe(MIN_FONT_SIZE);
    expect(clampFontSize(99)).toBe(MAX_FONT_SIZE);
    expect(clampFontSize(14.4)).toBe(14);
    expect(clampFontSize(Number.NaN)).toBe(DEFAULT_APPEARANCE.fontSize);
  });

  it('names a bundled face first, or follows the app Code font', () => {
    expect(fontFamilyFor('jetbrains-mono')).toMatch(/^"JetBrains Mono",/);
    expect(fontFamilyFor('app')).toBe('var(--mono)');
  });
});
