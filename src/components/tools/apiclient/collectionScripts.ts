// Finding and removing the executable scripts carried by an imported collection.
//
// A Postman collection file can embed pre-request and test scripts, and those
// run automatically the moment the user sends one of its requests — with the
// same reach any script in this tool has, including the network. Importing a
// collection someone sent you is therefore an execution decision, not just a
// data import, so the UI asks before accepting the scripts (see
// ImportReviewDialog).
//
// Everything here is pure so the scan and the strip can be tested directly.

import type { Collection, TreeItem } from './types';

export type ScriptKind = 'pre-request' | 'post-response' | 'tests';

export interface ScriptFinding {
  /** Where it lives, e.g. "Auth / Login". Empty string for the collection root. */
  path: string;
  kind: ScriptKind;
  code: string;
}

const join = (parent: string, name: string) => (parent ? `${parent} / ${name}` : name);

function scanItems(items: TreeItem[], parent: string, out: ScriptFinding[]): void {
  for (const item of items) {
    const path = join(parent, item.name);
    if (item.type === 'folder') {
      if (item.script?.req?.trim()) out.push({ path, kind: 'pre-request', code: item.script.req });
      if (item.script?.res?.trim()) out.push({ path, kind: 'post-response', code: item.script.res });
      scanItems(item.items, path, out);
      continue;
    }
    if (item.script?.req?.trim()) out.push({ path, kind: 'pre-request', code: item.script.req });
    if (item.script?.res?.trim()) out.push({ path, kind: 'post-response', code: item.script.res });
    if (item.tests?.trim()) out.push({ path, kind: 'tests', code: item.tests });
  }
}

/** Every script the collection would execute, in tree order. */
export function findScripts(collection: Collection): ScriptFinding[] {
  const out: ScriptFinding[] = [];
  if (collection.script?.req?.trim()) out.push({ path: '', kind: 'pre-request', code: collection.script.req });
  if (collection.script?.res?.trim()) out.push({ path: '', kind: 'post-response', code: collection.script.res });
  scanItems(collection.items, '', out);
  return out;
}

function stripItems(items: TreeItem[]): TreeItem[] {
  return items.map((item) => {
    if (item.type === 'folder') {
      return { ...item, script: { req: '', res: '' }, items: stripItems(item.items) };
    }
    return { ...item, script: { req: '', res: '' }, tests: '' };
  });
}

/**
 * The same collection with every script emptied. Ids, requests, headers, auth
 * and folder structure are untouched — only the executable parts are dropped,
 * so the collection stays fully usable and the user can paste a script back in
 * later after reading it.
 */
export function stripScripts(collection: Collection): Collection {
  return { ...collection, script: { req: '', res: '' }, items: stripItems(collection.items) };
}

// A conservative, best-effort scan for direct network calls in a script's
// source text. Scripts run as real JavaScript (see runtime.ts) with an
// unrestricted `fetch`/`XMLHttpRequest`/`WebSocket` — separate from the app's
// own Send pipeline — so a script can read a variable (an environment token,
// say) and ship it anywhere. This is not a parser and is not a security
// boundary: it's a plain-text pattern match meant to surface the same "this
// script can talk to the network" heads-up whether the script arrived via a
// collection import (see ImportReviewDialog) or was typed/pasted directly
// into a script editor. False negatives (an obfuscated call) and false
// positives (the word appearing in a comment or string) are both acceptable
// for an advisory warning.
const NETWORK_CALL_PATTERN = /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/;

export function scriptCallsNetwork(code: string): boolean {
  return NETWORK_CALL_PATTERN.test(code);
}
