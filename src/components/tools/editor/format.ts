// "Format Document" for the Text Editor, the way VS Code does it with its
// usual extensions:
//
//   Prettier      JS/JSX/TS/TSX, JSON, CSS/SCSS/LESS, HTML, Vue, Angular,
//                 Markdown, YAML, XML (@prettier/plugin-xml)
//   sql-formatter SQL and its dialects (PostgreSQL, MySQL, SQLite, T-SQL…)
//   Reindent      everything else that has a grammar: CodeMirror re-indents
//                 every line by the language's own rules and trims trailing
//                 whitespace (VS Code's "Reindent Lines").
//
// Prettier and its parsers are several MB, so each piece is a dynamic import
// loaded the first time a file of that kind is formatted.

import type { Options as PrettierOptions, Plugin } from 'prettier';
import type { SqlLanguage } from 'sql-formatter';

export type FormatterId = 'prettier' | 'sql-formatter' | 'reindent';

export interface FormatSettings {
  tabWidth: number;
  useTabs: boolean;
  /** Options read from the project's .prettierrc / package.json "prettier". */
  prettierConfig?: Record<string, unknown> | null;
}

interface PrettierTarget {
  parser: string;
  plugins: () => Promise<Plugin[]>;
}

const mod = <T>(p: Promise<T>) => p.then((m) => ((m as { default?: T }).default ?? m) as unknown as Plugin);
const estree = () => mod(import('prettier/plugins/estree'));
const babel = () => mod(import('prettier/plugins/babel'));
const typescript = () => mod(import('prettier/plugins/typescript'));
const postcss = () => mod(import('prettier/plugins/postcss'));
const html = () => mod(import('prettier/plugins/html'));
const markdown = () => mod(import('prettier/plugins/markdown'));
const yaml = () => mod(import('prettier/plugins/yaml'));
const angular = () => mod(import('prettier/plugins/angular'));
const xml = () => mod(import('@prettier/plugin-xml'));
const all = (...loaders: (() => Promise<Plugin>)[]) => () => Promise.all(loaders.map((l) => l()));

/** By language-data name (what the status bar shows). */
const PRETTIER: Record<string, PrettierTarget> = {
  JavaScript: { parser: 'babel', plugins: all(babel, estree) },
  JSX: { parser: 'babel', plugins: all(babel, estree) },
  TypeScript: { parser: 'typescript', plugins: all(typescript, estree) },
  TSX: { parser: 'typescript', plugins: all(typescript, estree) },
  JSON: { parser: 'json', plugins: all(babel, estree) },
  'JSON-LD': { parser: 'json', plugins: all(babel, estree) },
  CSS: { parser: 'css', plugins: all(postcss) },
  SCSS: { parser: 'scss', plugins: all(postcss) },
  LESS: { parser: 'less', plugins: all(postcss) },
  // HTML formats the <script>/<style> inside it too.
  HTML: { parser: 'html', plugins: all(html, babel, estree, postcss) },
  Vue: { parser: 'vue', plugins: all(html, babel, estree, postcss, typescript) },
  'Angular Template': { parser: 'angular', plugins: all(html, angular) },
  Markdown: { parser: 'markdown', plugins: all(markdown, babel, estree, postcss, yaml) },
  YAML: { parser: 'yaml', plugins: all(yaml) },
  XML: { parser: 'xml', plugins: all(xml) },
};

/** File names whose content is JSON-with-comments or JSON5 (VS Code's jsonc). */
const JSON5_NAMES = /(^|\/)(tsconfig[^/]*|jsconfig[^/]*|\.eslintrc|\.babelrc|devcontainer)\.json$|\.json5$|\.jsonc$/i;

/** sql-formatter's `language` per language-data SQL dialect. */
const SQL_DIALECT: Record<string, SqlLanguage> = {
  SQL: 'sql',
  PostgreSQL: 'postgresql',
  MySQL: 'mysql',
  'MariaDB SQL': 'mariadb',
  'MS SQL': 'transactsql',
  SQLite: 'sqlite',
  PLSQL: 'plsql',
  CQL: 'sql',
};

export interface FormatterInfo {
  id: FormatterId;
  /** Shown in the status bar, like VS Code's formatter extension name. */
  label: string;
}

/** Which formatter handles a language (null for plain text / no grammar). */
export function formatterFor(language: string | null): FormatterInfo | null {
  if (!language) return null;
  if (PRETTIER[language]) return { id: 'prettier', label: 'Prettier' };
  if (SQL_DIALECT[language]) return { id: 'sql-formatter', label: 'SQL Formatter' };
  return { id: 'reindent', label: 'Reindent' };
}

/** Options Prettier gets: the project's config wins over the editor's
 *  detected indentation, as with the VS Code extension. */
export function prettierOptions(target: { parser: string }, fileName: string, s: FormatSettings): PrettierOptions {
  const parser = target.parser === 'json' && JSON5_NAMES.test(fileName) ? 'json5' : target.parser;
  const cfg = { ...(s.prettierConfig ?? {}) };
  // A config can't change the parser for us, nor load plugins by name.
  delete cfg.parser;
  delete cfg.plugins;
  delete cfg.overrides;
  return {
    tabWidth: s.tabWidth,
    useTabs: s.useTabs,
    // The XML plugin preserves all whitespace by default, so nothing would
    // re-indent; VS Code's XML formatting reflows, so do that unless the
    // project says otherwise.
    ...(parser === 'xml' ? { xmlWhitespaceSensitivity: 'ignore' } : {}),
    ...cfg,
    parser,
    filepath: fileName,
  } as PrettierOptions;
}

export class FormatError extends Error {
  constructor(message: string, public line?: number, public column?: number) {
    super(message);
    this.name = 'FormatError';
  }
}

/** Formats with Prettier or sql-formatter. Returns null for languages those
 *  don't cover — the caller re-indents those with CodeMirror instead. */
export async function formatWithTool(
  text: string, language: string | null, fileName: string, settings: FormatSettings,
): Promise<string | null> {
  if (!language) return null;
  const target = PRETTIER[language];
  if (target) {
    const [{ format }, plugins] = await Promise.all([import('prettier/standalone'), target.plugins()]);
    try {
      return await format(text, { ...prettierOptions(target, fileName, settings), plugins });
    } catch (e) {
      const err = e as { message?: string; loc?: { start?: { line?: number; column?: number } } };
      // Prettier's message repeats a code frame after the first line.
      const first = (err.message ?? String(e)).split('\n')[0];
      throw new FormatError(first, err.loc?.start?.line, err.loc?.start?.column);
    }
  }
  const dialect = SQL_DIALECT[language];
  if (dialect) {
    const { format } = await import('sql-formatter');
    try {
      return format(text, {
        language: dialect as SqlLanguage,
        tabWidth: settings.tabWidth,
        useTabs: settings.useTabs,
        keywordCase: 'upper',
      });
    } catch (e) {
      throw new FormatError((e as Error).message.split('\n')[0]);
    }
  }
  return null;
}

/** Config files Prettier itself would read, nearest first per folder. */
export const PRETTIER_CONFIG_FILES = ['.prettierrc', '.prettierrc.json', '.prettierrc.yaml', '.prettierrc.yml', 'package.json'];

/** Parses one candidate config file; null when it holds no Prettier config. */
export async function parsePrettierConfig(name: string, text: string): Promise<Record<string, unknown> | null> {
  try {
    if (name === 'package.json') {
      const pkg = JSON.parse(text) as { prettier?: unknown };
      return pkg.prettier && typeof pkg.prettier === 'object' ? (pkg.prettier as Record<string, unknown>) : null;
    }
    if (name.endsWith('.json')) return JSON.parse(text) as Record<string, unknown>;
    // `.prettierrc` may be JSON or YAML; YAML is a superset, so try JSON first.
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      const { load } = await import('js-yaml');
      const v = load(text);
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    }
  } catch {
    return null;
  }
}
