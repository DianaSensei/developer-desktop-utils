// Sequencing rules for a Runner iteration, kept separate from the dialog so the
// decisions can be reasoned about (and tested) without a React tree.
//
// By default an iteration walks the planned list in order. A script can steer it
// with `setNextRequest`, which Postman resolves by request *name*:
//
//   setNextRequest('Login')  → jump to the first request with that name
//   setNextRequest(null)     → end this iteration now
//   (not called)             → continue with the next request in order
//
// A name that isn't in the run can't be honoured. Rather than aborting — which
// makes a small typo look like a broken collection — the run continues in order
// and the row is annotated so the mistake is visible.

export interface JumpRequest {
  to: string | null;
  missing?: boolean;
}

// Ceiling on executions in a single iteration, so a jump pointing backwards
// can't spin forever.
export const MAX_STEPS_PER_ITERATION = 1000;

// Turn the raw `nextRequest` off an ExecResult into something displayable, or
// undefined when no script asked for anything.
export function describeJump(
  next: string | null | undefined,
  names: string[],
): JumpRequest | undefined {
  if (next === undefined) return undefined;
  if (next === null) return { to: null };
  return names.includes(next) ? { to: next } : { to: next, missing: true };
}

// Names shared by more than one request in the planned run. `setNextRequest`
// (Postman-compatible by design — see the header comment) resolves by name
// via `names.indexOf`, always landing on the *first* match, so a duplicate
// makes any jump to that name ambiguous: a script author aiming for the
// second "Login" request would silently land on the first one instead.
// Surfaced so the Runner can warn about it before a run starts, rather than
// a script's jump landing on the wrong request mid-run with no explanation.
export function findDuplicateNames(names: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) duplicates.add(name);
    else seen.add(name);
  }
  return [...duplicates];
}

// Where the iteration goes after the request at `currentIndex`.
// Returns null when the iteration should end.
export function nextStepIndex(
  currentIndex: number,
  jump: JumpRequest | undefined,
  names: string[],
): number | null {
  if (jump) {
    if (jump.to === null) return null;
    const target = names.indexOf(jump.to);
    if (target !== -1) return target;
    // Unknown name — fall through to the next request in order.
  }
  const next = currentIndex + 1;
  return next < names.length ? next : null;
}
