/**
 * Dựng bản DÙNG MỘT MÌNH của trang mẫu.
 *
 * `index.html` cố ý `<link>` tới `../tokens.css` — đó là thứ khiến trang mẫu
 * không thể trôi lệch khỏi app, vì cả hai đọc chung một file. Nhưng nó cũng có
 * nghĩa là trang chỉ chạy đúng khi nằm cạnh `tokens.css`.
 *
 * Khi cần một file duy nhất (gửi cho ai đó, đăng lên Artifact, mở từ USB),
 * script này nội tuyến token vào rồi ghi ra `standalone.html`:
 *
 *     node design/preview/build-standalone.mjs
 *
 * Đừng sửa `standalone.html` bằng tay — nó được sinh ra, sửa `index.html`
 * hoặc `tokens.css` rồi chạy lại.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, 'index.html'), 'utf-8');
const tokens = readFileSync(resolve(here, '../tokens.css'), 'utf-8');

const LINK = '<link rel="stylesheet" href="../tokens.css">';
if (!html.includes(LINK)) {
  throw new Error('index.html không còn link tới ../tokens.css — kiểm tra lại trước khi dựng.');
}

const out = html.replace(
  LINK,
  `<style>\n/* ↓↓↓ Nội tuyến từ design/tokens.css — KHÔNG sửa ở đây ↓↓↓ */\n${tokens}\n</style>`
);

writeFileSync(resolve(here, 'standalone.html'), out);
console.log(`standalone.html: ${out.length} bytes (token nội tuyến ${tokens.length} bytes)`);
