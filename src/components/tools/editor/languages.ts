// Syntax highlighting by file name. `@codemirror/language-data` lists ~150
// languages with their file patterns; each grammar is its own dynamic import,
// so opening a .py file downloads only the Python parser, and the list itself
// is loaded the first time any file is opened.

import type { LanguageDescription, LanguageSupport } from '@codemirror/language';

let catalog: Promise<{ describe: (name: string) => LanguageDescription | null }> | null = null;

function loadCatalog() {
  catalog ??= Promise.all([
    import('@codemirror/language-data'),
    import('@codemirror/language'),
  ]).then(([data, lang]) => ({
    describe: (name: string) => lang.LanguageDescription.matchFilename(data.languages, name)
      ?? EXTRA_NAMES[name.toLowerCase()]?.(data.languages, lang.LanguageDescription)
      ?? null,
  }));
  return catalog;
}

// Common files whose names language-data does not map.
const EXTRA_NAMES: Record<
  string,
  (all: readonly LanguageDescription[], LD: typeof LanguageDescription) => LanguageDescription | null
> = {
  '.env': (all, LD) => LD.matchLanguageName(all, 'properties', false),
  '.gitignore': (all, LD) => LD.matchLanguageName(all, 'shell', false),
  '.npmrc': (all, LD) => LD.matchLanguageName(all, 'properties', false),
  '.editorconfig': (all, LD) => LD.matchLanguageName(all, 'properties', false),
};

export interface LoadedLanguage {
  name: string;
  support: LanguageSupport;
}

/** The grammar for `fileName`, or null for plain text. Never throws. */
export async function loadLanguage(fileName: string): Promise<LoadedLanguage | null> {
  try {
    const { describe } = await loadCatalog();
    const desc = describe(fileName);
    if (!desc) return null;
    const support = await desc.load();
    return { name: desc.name, support };
  } catch {
    return null;
  }
}
