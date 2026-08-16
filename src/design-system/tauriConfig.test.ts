import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Tauri merge config theo JSON Merge Patch (RFC 7386) — khoá `windows` là một
 * MẢNG nên bị THAY THẾ TOÀN BỘ bởi file platform-specific, không merge từng
 * field. Kết quả: `tauri.windows.conf.json` / `tauri.linux.conf.json` phải
 * chép lại NGUYÊN VẸN mọi field chung (fullscreen/resizable/title/width/
 * height/minWidth/minHeight) từ `tauri.conf.json`, không chỉ phần khác biệt
 * (decorations). Không có gì trong hệ thống config của Tauri ép ba file này
 * đồng bộ — sửa `width` ở file gốc mà quên sửa hai file platform thì
 * Windows/Linux âm thầm dùng kích thước cũ, không lỗi build, không cảnh báo.
 *
 * Test này thay cho việc "nhớ" — đổi field chung ở một file mà quên hai file
 * kia thì CI đỏ ngay, với đúng tên field + platform bị lệch.
 */

const ROOT = resolve(__dirname, '../../src-tauri');

function readWindowConfig(file: string): Record<string, unknown> {
  const json = JSON.parse(readFileSync(resolve(ROOT, file), 'utf-8'));
  return json.app.windows[0];
}

// Field nào mang tính "cửa sổ nói chung" (không phải chrome/titlebar) thì phải
// giống hệt nhau ở mọi platform. Field platform-specific thật sự (titleBarStyle,
// hiddenTitle, trafficLightPosition — macOS; decorations — Windows/Linux)
// KHÔNG nằm trong danh sách này, chúng được PHÉP khác nhau.
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
