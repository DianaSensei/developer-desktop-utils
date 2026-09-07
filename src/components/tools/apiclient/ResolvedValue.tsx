// The "Resolved" cell shared by every Name/Value table in the request pane —
// KeyValueEditor (query, headers, url-encoded body), MultipartEditor
// (form-data) and RequestPanel's path-params table.
//
// One implementation, because these tables sit within a few hundred pixels of
// each other and a value that resolves differently (or is coloured
// differently) between them would read as a bug in the app rather than a
// difference between tables.

import { type VarMap } from './types';
import { previewVars } from './vars';

/**
 * Whether a table should carry the Resolved column at all: only when it has
 * variables to resolve against AND at least one of its values actually uses a
 * {{token}}. A permanently empty column in a table of literal values is the
 * kind of decorative space this UI has no room for.
 *
 * Pass every row's value, not just the visible ones — filtering down to rows
 * without tokens must not pull the column out from under the table.
 *
 * Returns a plain boolean rather than a `vars is VarMap` type predicate:
 * predicates don't narrow through a stored variable, so the call sites would
 * still need their own `vars &&` check and the signature would only imply a
 * narrowing that never happens.
 */
export function showsResolvedColumn(values: string[], vars?: VarMap): boolean {
  return !!vars && values.some((v) => previewVars(v, vars).hasTokens);
}

/**
 * What a value containing {{tokens}} resolves to right now. Renders nothing
 * for a value with no tokens — the column exists for the rows that have them,
 * and a literal value repeated verbatim one column over would be noise.
 *
 * An unresolved token is the case worth shouting about: it is sent literally,
 * so the request goes out with `{{userId}}` in it. That reads as red text
 * naming the token, not as a resolved value.
 *
 * Secrets need no special handling: the map these previews read (`varMap` in
 * ApiClient.tsx) already substitutes `••••••••` for Vault entries and
 * secret-flagged environment variables, so a real secret has no path here.
 */
export function ResolvedValue({ value, vars }: { value: string; vars: VarMap }) {
  const { resolved, missing, hasTokens } = previewVars(value, vars);
  if (!hasTokens) return null;
  if (missing.length > 0) {
    const names = missing.map((m) => `{{${m}}}`).join(', ');
    return (
      <span
        className="truncate font-mono text-[11px] text-bad"
        title={`No value for ${names} — it will be sent literally.`}
      >
        {names} undefined
      </span>
    );
  }
  return (
    <span className="truncate font-mono text-[11px] text-fg-mute" title={resolved}>
      {resolved || <span className="italic">empty</span>}
    </span>
  );
}
