import { describe, expect, it } from 'vitest';
import { describeJump, nextStepIndex } from './runnerFlow';

const names = ['Login', 'Fetch User', 'Cleanup'];

describe('describeJump', () => {
  it('returns undefined when no script asked for anything', () => {
    expect(describeJump(undefined, names)).toBeUndefined();
  });

  it('marks an end-of-iteration request', () => {
    expect(describeJump(null, names)).toEqual({ to: null });
  });

  it('resolves a known name', () => {
    expect(describeJump('Cleanup', names)).toEqual({ to: 'Cleanup' });
  });

  it('flags a name that is not in the run', () => {
    expect(describeJump('Typo', names)).toEqual({ to: 'Typo', missing: true });
  });
});

describe('nextStepIndex', () => {
  it('advances in order when no jump was requested', () => {
    expect(nextStepIndex(0, undefined, names)).toBe(1);
    expect(nextStepIndex(1, undefined, names)).toBe(2);
  });

  it('ends the iteration after the last request', () => {
    expect(nextStepIndex(2, undefined, names)).toBeNull();
  });

  it('ends the iteration on a null jump', () => {
    expect(nextStepIndex(0, { to: null }, names)).toBeNull();
  });

  it('jumps forward to a named request', () => {
    expect(nextStepIndex(0, { to: 'Cleanup' }, names)).toBe(2);
  });

  it('jumps backwards, which is how retry loops are written', () => {
    expect(nextStepIndex(2, { to: 'Login' }, names)).toBe(0);
  });

  it('can target the request that just ran', () => {
    expect(nextStepIndex(1, { to: 'Fetch User' }, names)).toBe(1);
  });

  it('falls through in order when the target is unknown', () => {
    expect(nextStepIndex(0, { to: 'Typo', missing: true }, names)).toBe(1);
  });

  it('ends the iteration when an unknown target follows the last request', () => {
    expect(nextStepIndex(2, { to: 'Typo', missing: true }, names)).toBeNull();
  });

  it('handles a single-request run', () => {
    expect(nextStepIndex(0, undefined, ['Only'])).toBeNull();
    expect(nextStepIndex(0, { to: 'Only' }, ['Only'])).toBe(0);
  });
});

describe('a full sequence', () => {
  // Walk the plan the way the Runner does, following whatever jumps say.
  const walk = (jumps: Record<number, Parameters<typeof nextStepIndex>[1]>, limit = 10) => {
    const visited: string[] = [];
    let index: number | null = 0;
    let steps = 0;
    while (index !== null && steps < limit) {
      visited.push(names[index]);
      index = nextStepIndex(index, jumps[steps], names);
      steps += 1;
    }
    return visited;
  };

  it('runs everything in order by default', () => {
    expect(walk({})).toEqual(['Login', 'Fetch User', 'Cleanup']);
  });

  it('skips the middle request when the first jumps past it', () => {
    expect(walk({ 0: { to: 'Cleanup' } })).toEqual(['Login', 'Cleanup']);
  });

  it('repeats a request until a later step stops jumping back', () => {
    // Fetch User (step 1) loops back to itself once, then continues.
    expect(walk({ 1: { to: 'Fetch User' } })).toEqual(['Login', 'Fetch User', 'Fetch User', 'Cleanup']);
  });

  it('bails out early on a null jump', () => {
    expect(walk({ 1: { to: null } })).toEqual(['Login', 'Fetch User']);
  });

  it('loops forever without the caller-side step ceiling', () => {
    // Guards the assumption behind MAX_STEPS_PER_ITERATION: the sequencing
    // itself has no natural stopping point when a jump cycles.
    expect(walk({ 0: { to: 'Login' }, 1: { to: 'Login' }, 2: { to: 'Login' } }, 4))
      .toEqual(['Login', 'Login', 'Login', 'Login']);
  });
});
