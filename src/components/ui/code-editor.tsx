// Purpose-built code editors — one per language, each with only the features
// that make sense for it (e.g. JSON gets `jsonParseLinter`'s precise
// whole-document check; SQL/JS get the cheaper syntax-error-node linter,
// since neither has a real linter package — see syntax-lint.ts).
// Every tool that needs an editable code surface picks one of these instead
// of reaching into CodeMirror or a `language` prop — swapping the engine
// later, or adding a language-specific feature, touches this file only.
//
// A tool whose format is chosen at runtime (JSON vs plain text, say) renders
// whichever component fits instead of passing a prop:
//
//   {format === 'json' ? <JsonEditor .../> : <TextEditor .../>}
//
// That's also what remounts the editor when the format changes — CodeMirror
// requires a fresh instance to swap grammar, so this replaces the old
// `key={format}` + `language={format}` pairing with plain component identity.

import { javascript } from '@codemirror/lang-javascript';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { linter, lintGutter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { CodeSurface, type CodeSurfaceProps } from '@/components/ui/code-editor-base';
import { syntaxErrorLinter } from '@/components/ui/syntax-lint';

const jsonLang = json();
const jsLang = javascript();
const sqlLang = sql();
// jsonParseLinter() flags an empty document as invalid (empty string isn't
// valid JSON) — that would put a permanent error marker on a pristine,
// untouched field before the user has typed anything. Skip linting until
// there's real content.
const jsonLintSource = jsonParseLinter();
const jsonLint = [linter((view) => (view.state.doc.length === 0 ? [] : jsonLintSource(view))), lintGutter()];
// JS/SQL have no dedicated linter package (unlike JSON) — flag whatever the
// grammar itself already marks unparseable, which is still a real win over
// nothing (unclosed strings/brackets, stray tokens).
const syntaxLint = [syntaxErrorLinter(), lintGutter()];

export interface CodeEditorProps extends CodeSurfaceProps {}

/** JSON body/value editing — request bodies, GraphQL variables, Kafka/RabbitMQ
 *  payloads, stub responses. Flags invalid JSON inline as you type. */
export function JsonEditor(props: CodeEditorProps) {
  return <CodeSurface {...props} lang={jsonLang} extraExtensions={jsonLint} />;
}

/** JSON syntax highlighting without the strict inline linter — for surfaces
 *  that accept a JSON *superset* (comments, trailing commas, unquoted keys)
 *  and validate it themselves. `jsonParseLinter` only understands strict
 *  JSON, so pairing it with a lenient parser would flag input the tool
 *  itself considers valid. Used by the JSON Formatter's raw input. */
export function JsonSyntaxEditor(props: CodeEditorProps) {
  return <CodeSurface {...props} lang={jsonLang} />;
}

export interface JavaScriptEditorProps extends CodeEditorProps {
  /** Extra extensions layered onto the base JS editor — e.g. ApiClient's
   *  bru/pm/req/res completion source plus its syntax-error lint gutter (see
   *  `scriptApiExtensions` in scriptCompletion.ts). Not baked in here because
   *  `JavaScriptEditor` also renders Mock Server's Rhai scripts, which merely
   *  borrow JS highlighting — a JS-grammar syntax linter would flag valid
   *  Rhai as an error the moment its syntax diverges from JS's, and the
   *  bru/pm/req/res completions are meaningless there. Omit for a plain JS
   *  (or Rhai-via-JS-highlighting) editor. */
  extraExtensions?: Extension[];
}

/** JavaScript editing — pre/post-request scripts, tests, Mock Server's Rhai
 *  scripts (JS-like enough for useful highlighting; no Rhai grammar package
 *  exists). */
export function JavaScriptEditor({ extraExtensions = [], ...props }: JavaScriptEditorProps) {
  return <CodeSurface {...props} lang={jsLang} extraExtensions={extraExtensions} />;
}

/** SQL editing (SQL Formatter uses its own bespoke setup for the SQL↔Mongo
 *  runtime language switch; this is for tools that just need a plain SQL
 *  surface, e.g. read-only SQL output). */
export function SqlEditor(props: CodeEditorProps) {
  return <CodeSurface {...props} lang={sqlLang} extraExtensions={syntaxLint} />;
}

/** No grammar — plain text, arbitrary formats (CSV, YAML, raw bodies, Rhai
 *  scripts) that don't have a CodeMirror language package. */
export function TextEditor(props: CodeEditorProps) {
  return <CodeSurface {...props} lang={null} />;
}
