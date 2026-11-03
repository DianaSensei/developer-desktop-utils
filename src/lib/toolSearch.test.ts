import { describe, expect, it } from 'vitest';
import { searchTools, toolMatchRank, toolMatchesQuery } from '@/lib/toolSearch';

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

describe('searchTools ranking', () => {
  const tools = [
    { label: 'Data Converter', description: 'JSON, YAML, CSV', keywords: ['json to yaml'] },
    { label: 'Regex Tester', description: 'test patterns', keywords: [] },
    { label: 'JSON Formatter', description: 'format', keywords: [] },
    { label: 'Cron Generator', description: 'schedule', keywords: ['crontab'] },
  ];
  it('puts label matches before keyword/description matches, keeping order on ties', () => {
    expect(searchTools(tools, 'json').map((t) => t.label)).toEqual(['JSON Formatter', 'Data Converter']);
    expect(searchTools(tools, 'gen').map((t) => t.label)).toEqual(['Cron Generator']);
    expect(searchTools(tools, '').map((t) => t.label)).toEqual(tools.map((t) => t.label));
  });
  it('ranks a word-start in the label above a mid-word hit', () => {
    expect(toolMatchRank({ label: 'Cron Generator', description: '' }, 'gen')).toBe(1);
    expect(toolMatchRank({ label: 'Cron Generator', description: '' }, 'cron')).toBe(0);
    expect(toolMatchRank({ label: 'Cron Generator', description: '' }, 'erat')).toBe(2);
  });
});
