import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';

// Meeting notes are shared app-wide so both the Meeting Notes tool and the Time
// Tracker (calendar + schedule) read and write the same records. The provider is
// mounted above the router, so edits in one tool are live in the other.

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;

export interface Meeting {
  id: string;
  title: string;
  start: number; // epoch ms
  end: number;   // epoch ms
  participants: string; // free text, one per line or comma-separated
  agenda: string;       // discussion / main content, one point per line
  decisions: string;    // one per line
  actions: string;      // one task per line
  createdAt: number;
  updatedAt: number;
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Now rounded down to the hour (sensible default start for a new meeting).
function defaultStart(): number {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

interface MeetingsContextValue {
  meetings: Meeting[];
  getMeeting: (id: string | null) => Meeting | undefined;
  addMeeting: (partial?: Partial<Omit<Meeting, 'id' | 'createdAt' | 'updatedAt'>>) => Meeting;
  updateMeeting: (id: string, patch: Partial<Meeting>) => void;
  deleteMeeting: (id: string) => void;
}

const MeetingsContext = createContext<MeetingsContextValue | undefined>(undefined);

export function MeetingsProvider({ children }: { children: ReactNode }) {
  const [meetings, setMeetings] = usePersistentState<Meeting[]>('devtool:meetings', []);

  const byId = useMemo(() => new Map(meetings.map((m) => [m.id, m])), [meetings]);
  const getMeeting = useCallback((id: string | null) => (id ? byId.get(id) : undefined), [byId]);

  const addMeeting = useCallback<MeetingsContextValue['addMeeting']>(
    (partial = {}) => {
      const start = partial.start ?? defaultStart();
      const end = partial.end ?? start + MS_HOUR;
      const ts = Date.now();
      const meeting: Meeting = {
        id: uid(),
        title: partial.title ?? '',
        start,
        end: Math.max(end, start),
        participants: partial.participants ?? '',
        agenda: partial.agenda ?? '',
        decisions: partial.decisions ?? '',
        actions: partial.actions ?? '',
        createdAt: ts,
        updatedAt: ts,
      };
      setMeetings((prev) => [...prev, meeting]);
      return meeting;
    },
    [setMeetings],
  );

  const updateMeeting = useCallback(
    (id: string, patch: Partial<Meeting>) =>
      setMeetings((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: Date.now() } : m))),
    [setMeetings],
  );

  const deleteMeeting = useCallback(
    (id: string) => setMeetings((prev) => prev.filter((m) => m.id !== id)),
    [setMeetings],
  );

  const value: MeetingsContextValue = { meetings, getMeeting, addMeeting, updateMeeting, deleteMeeting };
  return <MeetingsContext.Provider value={value}>{children}</MeetingsContext.Provider>;
}

export function useMeetings(): MeetingsContextValue {
  const ctx = useContext(MeetingsContext);
  if (!ctx) throw new Error('useMeetings must be used within MeetingsProvider');
  return ctx;
}

// ── helpers ─────────────────────────────────────────────────────────────────

export function meetingDurationMs(m: Pick<Meeting, 'start' | 'end'>): number {
  return Math.max(0, m.end - m.start);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateISO(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function toHM(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function combineDateTime(dateISO: string, hm: string): number | null {
  const [y, mo, da] = dateISO.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  if (!y || !mo || !da || Number.isNaN(h) || Number.isNaN(mi)) return null;
  return new Date(y, mo - 1, da, h, mi, 0, 0).getTime();
}

export function formatDuration(ms: number): string {
  const mins = Math.round(ms / MS_MIN);
  if (mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ') || '0m';
}

function parseList(value: string): string[] {
  return value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}
function parseLines(value: string): string[] {
  return value.split('\n').map((s) => s.trim()).filter(Boolean);
}

// Build clean, copyable Markdown minutes from a meeting.
export function buildMeetingMarkdown(m: Meeting): string {
  const out: string[] = [];
  out.push(`# ${m.title.trim() || 'Meeting Notes'}`);
  out.push('');

  const startD = new Date(m.start);
  const dateStr = startD.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = `${startD.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${new Date(m.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  const meta: string[] = [];
  meta.push(`**Date:** ${dateStr}`);
  meta.push(`**Time:** ${timeStr} (${formatDuration(meetingDurationMs(m))})`);
  const people = parseList(m.participants);
  if (people.length) meta.push(`**Participants:** ${people.join(', ')}`);
  out.push(meta.join('  \n'));
  out.push('');

  const section = (heading: string, items: string[], checkbox = false) => {
    if (!items.length) return;
    out.push(`## ${heading}`);
    for (const item of items) out.push(checkbox ? `- [ ] ${item}` : `- ${item}`);
    out.push('');
  };
  section('Agenda & Discussion', parseLines(m.agenda));
  section('Decisions', parseLines(m.decisions));
  section('Action Items', parseLines(m.actions), true);

  return `${out.join('\n').trim()}\n`;
}
