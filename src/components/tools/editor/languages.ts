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

/** Every language name the editor can highlight, A→Z (for "Change Language Mode"). */
export async function listLanguageNames(): Promise<string[]> {
  const data = await import('@codemirror/language-data');
  return [...new Set(data.languages.map((l) => l.name))].sort((a, b) => a.localeCompare(b));
}

/** The grammar for a language picked by name; null for unknown / plain text. */
export async function loadLanguageByName(name: string): Promise<LoadedLanguage | null> {
  try {
    const [data, lang] = await Promise.all([import('@codemirror/language-data'), import('@codemirror/language')]);
    const desc = lang.LanguageDescription.matchLanguageName(data.languages, name, false);
    if (!desc) return null;
    return { name: desc.name, support: await desc.load() };
  } catch {
    return null;
  }
}

/**
 * A best guess at what was typed or pasted into an untitled tab (VS Code
 * auto-detects too). Cheap, ordered heuristics over the first few KB; null
 * when nothing is convincing, which keeps the tab plain text.
 */
export function guessLanguage(text: string): string | null {
  const head = text.slice(0, 4000).trimStart();
  if (!head) return null;
  if (/^#!.*\b(bash|sh|zsh)\b/.test(head)) return 'Shell';
  if (/^#!.*\bpython/.test(head)) return 'Python';
  if (/^#!.*\bnode\b/.test(head)) return 'JavaScript';
  if (/^<\?xml\b/i.test(head)) return 'XML';
  if (/^<!doctype html|^<html[\s>]/i.test(head)) return 'HTML';
  if (/^[[{]/.test(head)) {
    try { JSON.parse(text); return 'JSON'; } catch { /* not JSON */ }
  }
  if (/^<([a-z][\w-]*)[\s>][\s\S]*<\/\1>\s*$/i.test(head)) return 'HTML';
  // SQL scripts often open with `--` / `/* */` comments: look past them.
  const sqlHead = head.replace(/^(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|\s+)+/, '');
  if (/^(SELECT|WITH|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(TABLE|INDEX|VIEW|OR\s+REPLACE)|ALTER\s+TABLE|DROP\s+TABLE|START\s+TRANSACTION|SET\s+@)\b/i.test(sqlHead)) return 'SQL';
  if (/^(import\s.+\sfrom\s|export\s+(default\s+)?(function|const|class|interface|type)\b)/m.test(head)) {
    return /:\s*(string|number|boolean|any)\b|\binterface\s+\w+|\btype\s+\w+\s*=/.test(head) ? 'TypeScript' : 'JavaScript';
  }
  if (/^(def\s+\w+\(.*\)\s*(->.*)?:|class\s+\w+(\(.*\))?:|from\s+[\w.]+\s+import\s|import\s+[\w.]+\s*$)/m.test(head)) return 'Python';
  if (/^(package\s+\w+|func\s+\w+\(.*\)\s*\{)/m.test(head) && /\bfunc\b/.test(head)) return 'Go';
  if (/^[ \t]*(fn[ \t]+\w|use[ \t]+[\w:]+;|impl\b|pub[ \t]+(fn|struct|enum)\b)/m.test(head)) return 'Rust';
  if (/^(function\s+\w+\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|console\.log\()/m.test(head)) return 'JavaScript';
  // A selector line opening a block, and a `property: value;` line. Two
  // simple patterns rather than one nested one, which backtracks badly.
  if (/^[.#]?[\w-][^{\n]{0,200}\{/m.test(head) && /^[ \t]*[\w-]+[ \t]*:[^;\n]+;/m.test(head)) return 'CSS';
  if (/^(#{1,6}[ \t]+\S|[-*][ \t]+\[[ x]\][ \t])/m.test(head) || /\[[^\]\n]{1,200}\]\([^)\n]{1,500}\)/.test(head)) return 'Markdown';
  if (/^---\s*$|^[\w-]+:\s+\S.*\n[\w-]+:\s+\S/m.test(head) && !/[;{}]/.test(head)) return 'YAML';
  return null;
}
