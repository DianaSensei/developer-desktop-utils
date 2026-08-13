// Purpose-built code editors — one per language, each with only the features
// that make sense for it (e.g. JSON gets an inline linter; SQL/JS don't).
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
import { CodeSurface, type CodeSurfaceProps } from '@/components/ui/code-editor-base';

const jsonLang = json();
const jsLang = javascript();
const sqlLang = sql();
const jsonLint = [linter(jsonParseLinter()), lintGutter()];

export interface CodeEditorProps extends CodeSurfaceProps {}

/** JSON body/value editing — request bodies, GraphQL variables, Kafka/RabbitMQ
 *  payloads, stub responses. Flags invalid JSON inline as you type. */
export function JsonEditor(props: CodeEditorProps) {
  return <CodeSurface {...props} lang={jsonLang} extraExtensions={jsonLint} />;
}

/** JavaScript editing — pre/post-request scripts, tests. */
export function JavaScriptEditor(props: CodeEditorProps) {
  return <CodeSurface {...props} lang={jsLang} />;
}

/** SQL editing (SQL Formatter uses its own bespoke setup for the SQL↔Mongo
 *  runtime language switch; this is for tools that just need a plain SQL
 *  surface, e.g. read-only SQL output). */
export function SqlEditor(props: CodeEditorProps) {
  return <CodeSurface {...props} lang={sqlLang} />;
}

/** No grammar — plain text, arbitrary formats (CSV, YAML, raw bodies, Rhai
 *  scripts) that don't have a CodeMirror language package. */
export function TextEditor(props: CodeEditorProps) {
  return <CodeSurface {...props} lang={null} />;
}
