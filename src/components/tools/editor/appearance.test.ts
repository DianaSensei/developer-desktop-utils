import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, MAX_FONT_SIZE, MIN_FONT_SIZE, clampFontSize, clampLetterSpacing, clampLineHeight, fontFamilyFor, normalizeAppearance } from './appearance';

describe('editor appearance', () => {
  it('defaults to the IntelliJ look with JetBrains Mono and SQL hints', () => {
    expect(normalizeAppearance(null)).toEqual({
      theme: 'intellij', font: 'jetbrains-mono', fontSize: 13, hints: true,
      lineHeight: 1.6, letterSpacing: 0, weight: 400, smoothing: 'thin', padding: 'normal',
    });
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
  });

  it('keeps valid saved values and drops unknown ones', () => {
    const custom = {
      theme: 'vscode', font: 'fira-code', fontSize: 15, hints: false,
      lineHeight: 1.4, letterSpacing: 0.5, weight: 300, smoothing: 'full', padding: 'roomy',
    };
    expect(normalizeAppearance(custom)).toEqual(custom);
    expect(normalizeAppearance({
      theme: 'solarized', font: 'comic', fontSize: '15', hints: 'yes', lineHeight: 'tall', weight: 450, smoothing: 'x', padding: 9,
    })).toEqual(DEFAULT_APPEARANCE);
  });

  it('clamps the font size', () => {
    expect(clampFontSize(2)).toBe(MIN_FONT_SIZE);
    expect(clampFontSize(99)).toBe(MAX_FONT_SIZE);
    expect(clampFontSize(14.4)).toBe(14);
    expect(clampFontSize(Number.NaN)).toBe(DEFAULT_APPEARANCE.fontSize);
  });

  it('clamps line height and letter spacing to tidy steps', () => {
    expect(clampLineHeight(1.6000000001)).toBe(1.6);
    expect(clampLineHeight(9)).toBe(2.2);
    expect(clampLetterSpacing(0.3)).toBe(0.25);
    expect(clampLetterSpacing(-5)).toBe(-1);
  });

  it('names a bundled face first, or follows the app Code font', () => {
    expect(fontFamilyFor('jetbrains-mono')).toMatch(/^"JetBrains Mono",/);
    expect(fontFamilyFor('app')).toBe('var(--mono)');
  });
});
