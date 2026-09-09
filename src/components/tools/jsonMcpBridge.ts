// MCP bridge — JSON Formatter tool (`json`). Every operation here is a pure
// function of its argument — no persisted state — so, like
// codecMcpBridge.ts/jwtMcpBridge.ts, this is mounted unconditionally at the
// app root (McpUtilityBridge.tsx), gated only by the per-tool MCP toggle.
//
// Reuses JsonFormatter.tsx's own `parseInput` (a lenient parser: standard
// JSON plus single quotes, unquoted keys, trailing commas, // and /* */
// comments, and a JSON-string-literal fallback), `serialize`, and
// `quoteText` — the exact functions the UI's beautify/minify/string modes
// call — so there's one JSON engine, not a second copy for MCP.

import { INDENT_OPTIONS, parseInput, quoteText, serialize } from './JsonFormatter';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`"${name}" is required and must be a string`);
  return v;
}

function resolveIndent(v: unknown): string {
  if (typeof v !== 'string') return INDENT_OPTIONS['2'].unit;
  return (INDENT_OPTIONS[v] ?? INDENT_OPTIONS['2']).unit;
}

function resolveQuote(v: unknown): string {
  return v === "'" ? "'" : '"';
}

export function buildJsonHandlers(): Record<string, ToolHandler> {
  return {
    // Lenient parse (comments/trailing commas/single quotes/unquoted keys/
    // a bare JSON-string-literal all accepted, same as the UI) then
    // pretty-print. `indent` is "2" (default) | "4" | "tab"; `quote` is
    // `"` (default) or `'`.
    json_format: async (args) => {
      const value = parseInput(requireString(args.text, 'text'));
      return { output: serialize(value, resolveIndent(args.indent), resolveQuote(args.quote)) };
    },

    json_minify: async (args) => {
      const value = parseInput(requireString(args.text, 'text'));
      return { output: serialize(value, '', resolveQuote(args.quote)) };
    },

    // The minified JSON re-encoded as a single quoted string literal
    // (escapes embedded quotes/newlines/control chars) — useful for
    // embedding a JSON payload inside another string (e.g. a shell command
    // or a source file).
    json_to_string: async (args) => {
      const value = parseInput(requireString(args.text, 'text'));
      return { output: quoteText(serialize(value, '', '"'), resolveQuote(args.quote)) };
    },

    json_validate: async (args) => {
      try {
        parseInput(requireString(args.text, 'text'));
        return { valid: true };
      } catch (e) {
        return { valid: false, error: (e as Error).message ?? String(e) };
      }
    },
  };
}
