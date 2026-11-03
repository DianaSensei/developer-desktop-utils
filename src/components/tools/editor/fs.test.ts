import { describe, expect, it } from 'vitest';
import { decodeFramed } from './fs';

function frame(meta: object, body: string): ArrayBuffer {
  const m = new TextEncoder().encode(JSON.stringify(meta));
  const b = new TextEncoder().encode(body);
  const out = new Uint8Array(4 + m.length + b.length);
  new DataView(out.buffer).setUint32(0, m.length, true);
  out.set(m, 4);
  out.set(b, 4 + m.length);
  return out.buffer;
}

describe('decodeFramed (editor_read_file reply)', () => {
  it('reads the metadata and the UTF-8 text after it', () => {
    const r = decodeFramed(frame({ binary: false, bom: true, size: 9, modified: 42 }, 'chào\nbạn'));
    expect(r).toEqual({ binary: false, bom: true, size: 9, modified: 42, content: 'chào\nbạn' });
  });

  it('a binary file has no text', () => {
    expect(decodeFramed(frame({ binary: true, bom: false, size: 3, modified: 1 }, '')).content).toBe('');
  });
});
