import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Tauri merges configs with JSON Merge Patch (RFC 7386); `windows` is an
 * array, so the platform files replace it entirely. tauri.windows.conf.json
 * and tauri.linux.conf.json must therefore repeat every shared window field
 * from tauri.conf.json. This test fails when they drift.
 */

const ROOT = resolve(__dirname, '../../src-tauri');

function readWindowConfig(file: string): Record<string, unknown> {
  const json = JSON.parse(readFileSync(resolve(ROOT, file), 'utf-8'));
  return json.app.windows[0];
}

// General window fields that must match on every platform. Chrome fields
// (titleBarStyle, hiddenTitle, trafficLightPosition, decorations) may differ.
const SHARED_FIELDS = ['fullscreen', 'resizable', 'title', 'width', 'height', 'minWidth', 'minHeight'] as const;

describe('tauri.conf.json — field chung khớp giữa các platform', () => {
  const base = readWindowConfig('tauri.conf.json');

  it.each(['tauri.windows.conf.json', 'tauri.linux.conf.json'] as const)('%s khớp base cho mọi field chung', (file) => {
    const platform = readWindowConfig(file);
    for (const field of SHARED_FIELDS) {
      expect(platform[field], `${file}: field "${field}" lệch với tauri.conf.json (base=${JSON.stringify(base[field])}, ${file}=${JSON.stringify(platform[field])}) — Tauri merge THAY THẾ nguyên mảng "windows", field chung phải chép lại y hệt, không tự kế thừa.`).toEqual(base[field]);
    }
  });

  it('cả hai file platform đều tắt decorations (đúng lý do file này tồn tại)', () => {
    for (const file of ['tauri.windows.conf.json', 'tauri.linux.conf.json']) {
      const platform = readWindowConfig(file);
      expect(platform.decorations, `${file}: decorations phải là false — nếu không cần override decorations nữa thì xoá hẳn file này, đừng để nó tồn tại mà không có lý do.`).toBe(false);
    }
  });
});
