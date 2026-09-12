import { describe, expect, it } from 'vitest';
import { repoTagLabel } from './ImagesView';

// Xác nhận không cần màn hình cho bug vừa sửa: Docker API trả `RepoTags: []`
// (mảng RỖNG) cho image chưa gắn tag hoặc image trung gian — không phải
// `null`/`undefined` — nên `tags ?? fallback` không kích hoạt được và tên
// image hiện trống trơn. `repoTagLabel` phải kiểm tra `.length`, không dựa
// vào `??`. Đây là ca lỗi thật quan sát được: 48 image thật trên máy, nhiều
// dòng tên trống — xem commit fix trên cả preview/chrome-bands và
// claude/dbx-design-reference-b1fbof.
describe('repoTagLabel', () => {
  it('dùng fallback khi RepoTags là mảng RỖNG (ca lỗi thật đã quan sát)', () => {
    expect(repoTagLabel([], ['<none>:<none>'])).toBe('<none>:<none>');
  });

  it('dùng fallback khi RepoTags là undefined', () => {
    expect(repoTagLabel(undefined, ['<none>:<none>'])).toBe('<none>:<none>');
  });

  it('giữ nguyên tag thật khi có', () => {
    expect(repoTagLabel(['redis:7-alpine'], ['<none>:<none>'])).toBe('redis:7-alpine');
  });

  it('nối nhiều tag bằng ", "', () => {
    expect(repoTagLabel(['a:1', 'a:latest'], ['<none>:<none>'])).toBe('a:1, a:latest');
  });

  it('fallback tuỳ biến được (hộp thoại xoá dùng Id thay vì "<none>:<none>")', () => {
    expect(repoTagLabel([], ['sha256:abc123'])).toBe('sha256:abc123');
  });
});
