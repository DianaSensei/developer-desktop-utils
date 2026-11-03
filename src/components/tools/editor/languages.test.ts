import { describe, expect, it } from 'vitest';
import { guessLanguage, loadLanguageByName } from './languages';

describe('guessLanguage', () => {
  it.each([
    ['{"a": 1}', 'JSON'],
    ['<?xml version="1.0"?><a/>', 'XML'],
    ['<!DOCTYPE html><html></html>', 'HTML'],
    ['SELECT * FROM users WHERE id = 1', 'SQL'],
    ["import { x } from './x';\nconst a: string = x;", 'TypeScript'],
    ["import x from 'x'\nx()", 'JavaScript'],
    ['def main():\n    return 0', 'Python'],
    ['#!/bin/bash\necho hi', 'Shell'],
    ['# Title\n\nSome text', 'Markdown'],
    ['name: app\nversion: 1', 'YAML'],
    ['fn main() {\n}', 'Rust'],
  ])('%s → %s', (text, lang) => {
    expect(guessLanguage(text)).toBe(lang);
  });

  it('stays plain text for prose', () => {
    expect(guessLanguage('just some notes about the meeting')).toBeNull();
    expect(guessLanguage('')).toBeNull();
  });

  it('loads a grammar by name, case-insensitively', async () => {
    expect((await loadLanguageByName('python'))?.name).toBe('Python');
    expect(await loadLanguageByName('No Such Language')).toBeNull();
  });
});
