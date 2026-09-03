import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  MeetingsProvider,
  useMeetings,
  meetingDurationMs,
  toDateISO,
  toHM,
  combineDateTime,
  formatDuration,
  buildMeetingMarkdown,
  type Meeting,
} from './meetings';

const store = new Map<string, string>();

vi.mock('@/lib/persistentStore', () => ({
  storageGet: (k: string) => (store.has(k) ? store.get(k)! : null),
  storageSet: (k: string, v: string) => { store.set(k, v); },
  flushPersistentStore: () => Promise.resolve(),
}));

beforeEach(() => {
  store.clear();
});

function baseMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    title: 'Standup',
    start: new Date(2026, 0, 5, 9, 0).getTime(),
    end: new Date(2026, 0, 5, 9, 30).getTime(),
    participants: '',
    agenda: '',
    decisions: '',
    actions: '',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('meetingDurationMs', () => {
  it('returns the ms between start and end', () => {
    expect(meetingDurationMs({ start: 1000, end: 4000 })).toBe(3000);
  });

  it('clamps a negative duration to 0', () => {
    expect(meetingDurationMs({ start: 5000, end: 1000 })).toBe(0);
  });
});

describe('toDateISO / toHM', () => {
  it('formats a timestamp as YYYY-MM-DD', () => {
    expect(toDateISO(new Date(2026, 2, 4).getTime())).toBe('2026-03-04');
  });

  it('pads single-digit month and day', () => {
    expect(toDateISO(new Date(2026, 0, 9).getTime())).toBe('2026-01-09');
  });

  it('formats a timestamp as HH:MM', () => {
    expect(toHM(new Date(2026, 0, 1, 9, 5).getTime())).toBe('09:05');
  });
});

describe('combineDateTime', () => {
  it('combines a date and time string into a timestamp', () => {
    const ts = combineDateTime('2026-01-05', '14:30');
    const d = new Date(ts!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(5);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });

  it('returns null for a malformed date', () => {
    expect(combineDateTime('', '14:30')).toBeNull();
  });

  it('returns null for a malformed time', () => {
    expect(combineDateTime('2026-01-05', 'nope')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('returns "0m" for zero or negative durations', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(-1000)).toBe('0m');
  });

  it('formats minutes only', () => {
    expect(formatDuration(25 * 60_000)).toBe('25m');
  });

  it('formats hours only when minutes are exactly 0', () => {
    expect(formatDuration(2 * 3_600_000)).toBe('2h');
  });

  it('formats hours and minutes together', () => {
    expect(formatDuration(90 * 60_000)).toBe('1h 30m');
  });
});

describe('buildMeetingMarkdown', () => {
  it('falls back to a default title when blank', () => {
    const md = buildMeetingMarkdown(baseMeeting({ title: '   ' }));
    expect(md).toContain('# Meeting Notes');
  });

  it('includes participants, agenda, decisions and action items as sections', () => {
    const md = buildMeetingMarkdown(
      baseMeeting({
        participants: 'Alice, Bob\nCarol',
        agenda: 'Discuss roadmap\nReview PRs',
        decisions: 'Ship v2',
        actions: 'File ticket',
      })
    );
    expect(md).toContain('# Standup');
    expect(md).toContain('**Participants:** Alice, Bob, Carol');
    expect(md).toContain('## Agenda & Discussion');
    expect(md).toContain('- Discuss roadmap');
    expect(md).toContain('## Decisions');
    expect(md).toContain('- Ship v2');
    expect(md).toContain('## Action Items');
    expect(md).toContain('- [ ] File ticket');
  });

  it('omits empty sections', () => {
    const md = buildMeetingMarkdown(baseMeeting());
    expect(md).not.toContain('**Participants:**');
    expect(md).not.toContain('## Agenda & Discussion');
    expect(md).not.toContain('## Decisions');
    expect(md).not.toContain('## Action Items');
  });
});

describe('MeetingsProvider / useMeetings', () => {
  it('throws when used outside a provider', () => {
    expect(() => renderHook(() => useMeetings())).toThrow(
      'useMeetings must be used within MeetingsProvider'
    );
  });

  it('starts with no meetings', () => {
    const { result } = renderHook(() => useMeetings(), { wrapper: MeetingsProvider });
    expect(result.current.meetings).toEqual([]);
  });

  it('addMeeting appends a meeting with generated id and defaults', () => {
    const { result } = renderHook(() => useMeetings(), { wrapper: MeetingsProvider });
    let created!: Meeting;
    act(() => { created = result.current.addMeeting({ title: 'Planning' }); });
    expect(created.title).toBe('Planning');
    expect(created.id).toBeTruthy();
    expect(created.end).toBeGreaterThan(created.start);
    expect(result.current.meetings).toHaveLength(1);
  });

  it('addMeeting clamps end to start when given an end before start', () => {
    const { result } = renderHook(() => useMeetings(), { wrapper: MeetingsProvider });
    let created!: Meeting;
    act(() => { created = result.current.addMeeting({ start: 5000, end: 1000 }); });
    expect(created.end).toBe(5000);
  });

  it('getMeeting looks up by id and returns undefined for null/unknown', () => {
    const { result } = renderHook(() => useMeetings(), { wrapper: MeetingsProvider });
    let created!: Meeting;
    act(() => { created = result.current.addMeeting({ title: 'Retro' }); });
    expect(result.current.getMeeting(created.id)?.title).toBe('Retro');
    expect(result.current.getMeeting(null)).toBeUndefined();
    expect(result.current.getMeeting('missing')).toBeUndefined();
  });

  it('updateMeeting patches fields and bumps updatedAt', () => {
    const { result } = renderHook(() => useMeetings(), { wrapper: MeetingsProvider });
    let created!: Meeting;
    act(() => { created = result.current.addMeeting({ title: 'Sync' }); });
    act(() => result.current.updateMeeting(created.id, { title: 'Sync v2' }));
    expect(result.current.getMeeting(created.id)?.title).toBe('Sync v2');
    expect(result.current.getMeeting(created.id)?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it('deleteMeeting removes the meeting', () => {
    const { result } = renderHook(() => useMeetings(), { wrapper: MeetingsProvider });
    let created!: Meeting;
    act(() => { created = result.current.addMeeting({ title: 'One-off' }); });
    act(() => result.current.deleteMeeting(created.id));
    expect(result.current.meetings).toHaveLength(0);
    expect(result.current.getMeeting(created.id)).toBeUndefined();
  });
});
