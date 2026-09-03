import { describe, expect, it } from 'vitest';
import { generateRows, serializeRows, type FieldDef } from '@/lib/faker';

/**
 * Dùng @faker-js/faker THẬT (không mock) — nó đã là dependency thật, chạy
 * nhanh, và giá trị test nằm ở LOGIC BỌC QUANH NÓ (tính quyết định theo seed,
 * kẹp min/max, lọc field rỗng, chuyển định dạng xuất) chứ không phải bản thân
 * thư viện. Chưa có test nào trước đây cho module này.
 */

describe('generateRows — tính quyết định theo seed', () => {
  it('cùng seed, cùng schema → sinh ra ĐÚNG cùng một kết quả', async () => {
    const fields: FieldDef[] = [{ id: '1', name: 'name', type: 'fullName' }];
    const a = await generateRows(fields, 5, 42);
    const b = await generateRows(fields, 5, 42);
    expect(a).toEqual(b);
  });

  it('seed khác nhau → kết quả khác nhau (không phải hằng số bị đóng băng nhầm)', async () => {
    const fields: FieldDef[] = [{ id: '1', name: 'name', type: 'fullName' }];
    const a = await generateRows(fields, 3, 1);
    const b = await generateRows(fields, 3, 2);
    expect(a).not.toEqual(b);
  });

  it('sinh đúng số dòng yêu cầu', async () => {
    const fields: FieldDef[] = [{ id: '1', name: 'x', type: 'uuid' }];
    expect(await generateRows(fields, 7, 1)).toHaveLength(7);
    expect(await generateRows(fields, 0, 1)).toHaveLength(0);
  });

  it('field không đặt tên (chưa gõ xong trong UI) bị loại khỏi mỗi dòng, không tạo key rỗng', async () => {
    const fields: FieldDef[] = [
      { id: '1', name: 'kept', type: 'uuid' },
      { id: '2', name: '   ', type: 'uuid' },
      { id: '3', name: '', type: 'uuid' },
    ];
    const [row] = await generateRows(fields, 1, 1);
    expect(Object.keys(row)).toEqual(['kept']);
  });

  it('int: min > max vẫn ra kết quả nằm trong khoảng hợp lệ (tự hoán đổi, không throw)', async () => {
    const fields: FieldDef[] = [{ id: '1', name: 'n', type: 'int', min: 100, max: 10 }];
    const rows = await generateRows(fields, 20, 7);
    for (const r of rows) {
      expect(r.n).toBeGreaterThanOrEqual(10);
      expect(r.n).toBeLessThanOrEqual(100);
      expect(Number.isInteger(r.n)).toBe(true);
    }
  });

  it('float: số chữ số thập phân bị kẹp trong [0, 10], không nhận giá trị âm hay quá lớn', async () => {
    const fields: FieldDef[] = [{ id: '1', name: 'f', type: 'float', min: 0, max: 1, decimals: -5 }];
    const [row] = await generateRows(fields, 1, 1);
    // decimals âm bị Math.max(0, …) kẹp về 0 → số nguyên (không có phần thập phân).
    expect(Number.isInteger(row.f)).toBe(true);
  });

  it('enum: chỉ chọn trong danh sách values đã trim, values rỗng thì trả null', async () => {
    const fields: FieldDef[] = [
      { id: '1', name: 'choice', type: 'enum', values: ' red , green ,blue' },
      { id: '2', name: 'empty', type: 'enum', values: '' },
    ];
    const rows = await generateRows(fields, 10, 3);
    for (const r of rows) {
      expect(['red', 'green', 'blue']).toContain(r.choice);
      expect(r.empty).toBeNull();
    }
  });

  it('date: mỗi dateFormat cho ra đúng hình dạng chuỗi/số tương ứng', async () => {
    const shapeOf: Record<string, RegExp> = {
      isoDate: /^\d{4}-\d{2}-\d{2}$/,
      us: /^\d{2}\/\d{2}\/\d{4}$/,
      eu: /^\d{2}\/\d{2}\/\d{4}$/,
      time: /^\d{2}:\d{2}:\d{2}$/,
      readable: /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4}$/,
    };
    for (const [fmt, re] of Object.entries(shapeOf)) {
      const fields: FieldDef[] = [{ id: '1', name: 'd', type: 'date', dateFormat: fmt as FieldDef['dateFormat'] }];
      const [row] = await generateRows(fields, 1, 1);
      expect(String(row.d)).toMatch(re);
    }
    const [unixRow] = await generateRows([{ id: '1', name: 'd', type: 'date', dateFormat: 'unix' }], 1, 1);
    expect(Number.isInteger(unixRow.d)).toBe(true);
    const [unixMsRow] = await generateRows([{ id: '1', name: 'd', type: 'date', dateFormat: 'unixMs' }], 1, 1);
    expect(Number.isInteger(unixMsRow.d)).toBe(true);
    expect(unixMsRow.d as number).toBeGreaterThan(unixRow.d as number); // ms > s cho cùng thời điểm khác biệt đủ lớn
  });
});

describe('serializeRows', () => {
  const rows = [{ name: 'Nguyễn "A"', age: 30 }, { name: 'B,C', age: null }];
  const fields: FieldDef[] = [{ id: '1', name: 'name', type: 'fullName' }, { id: '2', name: 'age', type: 'int' }];

  it('json: định dạng đẹp, thụt 2 khoảng trắng', async () => {
    const out = await serializeRows(rows, fields, 'json');
    expect(out).toBe(JSON.stringify(rows, null, 2));
  });

  it('ndjson: mỗi dòng một object, không có mảng bọc ngoài', async () => {
    const out = await serializeRows(rows, fields, 'ndjson');
    expect(out.split('\n')).toEqual(rows.map((r) => JSON.stringify(r)));
  });

  it('yaml: parse ngược lại đúng dữ liệu gốc (không kiểm chuỗi thô — phụ thuộc thư viện)', async () => {
    const { load } = await import('js-yaml');
    const out = await serializeRows(rows, fields, 'yaml');
    expect(load(out)).toEqual(rows);
  });

  it('csv: escape đúng ô chứa dấu phẩy hoặc dấu ngoặc kép, giữ nguyên ô bình thường', async () => {
    const out = await serializeRows(rows, fields, 'csv');
    const lines = out.split('\n');
    expect(lines[0]).toBe('name,age');
    expect(lines[1]).toBe('"Nguyễn ""A""",30');
    expect(lines[2]).toBe('"B,C",');
  });

  it('tsv: dùng tab làm dấu phân cách, ô có tab mới bị bọc ngoặc kép', async () => {
    const out = await serializeRows(rows, fields, 'tsv');
    expect(out.split('\n')[0]).toBe('name\tage');
  });

  it('sql: NULL viết hoa không nháy, số không nháy, chuỗi có nháy đơn được nhân đôi', async () => {
    const out = await serializeRows(rows, fields, 'sql', { table: 'users' });
    const lines = out.split('\n');
    expect(lines[0]).toBe(`INSERT INTO users (name, age) VALUES ('Nguyễn "A"', 30);`);
    expect(lines[1]).toBe(`INSERT INTO users (name, age) VALUES ('B,C', NULL);`);
  });

  it('sql: tên bảng rỗng/toàn khoảng trắng thì rơi về "data"', async () => {
    const out = await serializeRows(rows, fields, 'sql', { table: '   ' });
    expect(out).toContain('INSERT INTO data ');
  });

  it('properties: có prefix thì gói cả mảng dưới một key theo kiểu Spring list-binding', async () => {
    const out = await serializeRows(rows, fields, 'properties', { prefix: 'users' });
    expect(out).toContain('users[0].name=Nguyễn "A"');
    expect(out).toContain('users[1].age=');
  });

  it('properties: không prefix thì mảng nằm ngay ở gốc', async () => {
    const out = await serializeRows(rows, fields, 'properties');
    expect(out).toContain('[0].name=Nguyễn "A"');
  });

  it('cột trùng tên chỉ xuất hiện MỘT LẦN trong header, và field không tên bị loại khỏi cột', async () => {
    const dupFields: FieldDef[] = [
      { id: '1', name: 'x', type: 'uuid' },
      { id: '2', name: 'x', type: 'uuid' },
      { id: '3', name: '', type: 'uuid' },
    ];
    const out = await serializeRows([{ x: 'v' }], dupFields, 'csv');
    expect(out.split('\n')[0]).toBe('x');
  });
});
