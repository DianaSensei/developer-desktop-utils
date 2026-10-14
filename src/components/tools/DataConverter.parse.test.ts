import { describe, expect, it } from 'vitest';
import { parseInput } from '@/components/tools/DataConverter';

/** Converting must not change the data: ids, phone numbers and versions keep
 *  their exact text, and YAML merge keys are applied. */

describe('Data Converter — parseInput', () => {
  it('XML keeps leading zeros, versions and hex as written', async () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><r id="007"><zip>01234</zip><phone>0912345678</phone><ver>1.10</ver><hex>0x1F</hex><n>42</n><f>3.5</f><b>true</b></r>';
    expect(await parseInput('xml', xml)).toEqual({
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
      r: { '@_id': '007', zip: '01234', phone: '0912345678', ver: '1.10', hex: '0x1F', n: 42, f: 3.5, b: true },
    });
  });

  it('YAML merge keys (<<: *anchor) are applied', async () => {
    const yaml = 'base: &b {x: 1}\nchild:\n  <<: *b\n  y: 2';
    expect(await parseInput('yaml', yaml)).toEqual({ base: { x: 1 }, child: { x: 1, y: 2 } });
  });
});
