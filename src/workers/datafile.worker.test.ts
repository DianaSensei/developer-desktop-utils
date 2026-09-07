// `self.onmessage = …` is this worker's entire public surface, so the tests
// drive it directly, the same way the checksum/deduplicate/regex worker tests do.
//
// The first case is a regression test with a specific history: an automated
// fix added an origin guard that accepted only `self.location.origin`, and a
// dedicated worker receives '' — so every message was dropped and a large CSV
// silently never parsed. Nothing else in the suite would have caught it,
// because the worker path only runs for files over 200k characters.

import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';

const posted: unknown[] = [];

beforeAll(async () => {
  vi.stubGlobal('postMessage', (msg: unknown) => posted.push(msg));
  await import('@/workers/datafile.worker');
});
beforeEach(() => { posted.length = 0; });

const send = (data: unknown, origin = '') =>
  (self.onmessage as unknown as (e: MessageEvent) => void)({ data, origin } as MessageEvent);

describe('datafile.worker', () => {
  it('parses a CSV posted the way a dedicated worker actually receives it (empty origin)', () => {
    send({ name: 'users.csv', text: 'userId,token\n1,alpha\n2,beta\n' });

    expect(posted).toHaveLength(1);
    const msg = posted[0] as { type: string; parsed: { rows: unknown[]; columns: string[]; format: string } };
    expect(msg.type).toBe('result');
    expect(msg.parsed.format).toBe('csv');
    expect(msg.parsed.columns).toEqual(['userId', 'token']);
    expect(msg.parsed.rows).toEqual([
      { userId: '1', token: 'alpha' },
      { userId: '2', token: 'beta' },
    ]);
  });

  it('accepts a message carrying this page\'s own origin too', () => {
    send({ name: 'x.csv', text: 'a\n1\n' }, self.location.origin);
    expect((posted[0] as { type: string }).type).toBe('result');
  });

  it('drops a message from any other origin', () => {
    send({ name: 'x.csv', text: 'a\n1\n' }, 'https://evil.test');
    expect(posted).toEqual([]);
  });

  it('drops a message whose shape is not a parse request', () => {
    send({ name: 'x.csv' });
    send({ text: 'a\n1\n' });
    send(null);
    send('a string');
    expect(posted).toEqual([]);
  });

  it('reports a parse failure as an error message instead of throwing', () => {
    send({ name: 'broken.json', text: '{ not valid json' });

    expect(posted).toHaveLength(1);
    const msg = posted[0] as { type: string; message: string };
    expect(msg.type).toBe('error');
    expect(msg.message).toContain('JSON');
  });

  it('parses JSON rows as well as CSV', () => {
    send({ name: 'rows.json', text: '[{"id":1},{"id":2}]' });
    const msg = posted[0] as { type: string; parsed: { format: string; rows: unknown[] } };
    expect(msg.parsed.format).toBe('json');
    expect(msg.parsed.rows).toEqual([{ id: '1' }, { id: '2' }]);
  });
});
