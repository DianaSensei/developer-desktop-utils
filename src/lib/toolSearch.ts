/**
 * Khớp một tool với truy vấn tìm kiếm — sidebar và ⌘K dùng chung hàm này, nên
 * gõ cùng một chữ ở hai chỗ luôn ra cùng một kết quả.
 *
 * Tách khỏi App.tsx (nơi nó từng nằm) vì CommandPalette cần đúng logic này mà
 * không được import cả App.tsx.
 */

export interface SearchableTool {
  label: string;
  description: string;
  keywords?: string[];
}

/**
 * Tìm trong nhãn, mô tả, và từ khoá đồng nghĩa (để "epoch" ra Date/Time, "guid"
 * ra Generator, "postman" ra API Client dù chữ đó không có trong nhãn/mô tả).
 * Truy vấn nhiều từ khớp khi TẤT CẢ các từ đều xuất hiện đâu đó (AND), không
 * cần liền kề.
 */
export function toolMatchesQuery(tool: SearchableTool, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [tool.label, tool.description, ...(tool.keywords ?? [])]
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}
