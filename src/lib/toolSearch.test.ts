import { describe, expect, it } from 'vitest';
import { toolMatchesQuery } from '@/lib/toolSearch';

const CRON = { label: 'Cron Generator', description: 'Build and validate cron expressions.', keywords: ['crontab', 'schedule', 'quartz'] };
const DATETIME = { label: 'Date / Time', description: 'Convert timestamps.', keywords: ['epoch', 'unix time'] };

describe('toolMatchesQuery', () => {
  it('truy vấn rỗng khớp mọi tool', () => {
    expect(toolMatchesQuery(CRON, '')).toBe(true);
    expect(toolMatchesQuery(CRON, '   ')).toBe(true);
  });

  it('khớp theo nhãn, không phân biệt hoa thường', () => {
    expect(toolMatchesQuery(CRON, 'CRON')).toBe(true);
  });

  it('khớp qua từ khoá đồng nghĩa dù không có trong nhãn/mô tả', () => {
    expect(toolMatchesQuery(DATETIME, 'epoch')).toBe(true);
    expect(toolMatchesQuery(CRON, 'quartz')).toBe(true);
  });

  it('truy vấn nhiều từ khớp kiểu AND, không cần liền kề', () => {
    expect(toolMatchesQuery(CRON, 'cron schedule')).toBe(true);
    expect(toolMatchesQuery(CRON, 'cron sql')).toBe(false);
  });

  it('không khớp khi thiếu một từ', () => {
    expect(toolMatchesQuery(DATETIME, 'epoch guid')).toBe(false);
  });
});
