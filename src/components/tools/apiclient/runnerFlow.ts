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
