import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DatePicker } from '@/components/ui/date-picker';
import { TimePicker } from '@/components/ui/time-picker';
import { MessageSquare, Gavel, ListChecks, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type Meeting,
  combineDateTime,
  formatDuration,
  meetingDurationMs,
  toDateISO,
  toHM,
} from '@/lib/meetings';

// Editable fields for a meeting, shared by the Meeting Notes tool (`variant="page"`,
// a spacious two-column layout) and the Time Tracker calendar/schedule
// (`variant="dialog"`, a compact stack). Pure: state lives in the meeting record;
// edits flow up through `onChange`.
export function MeetingFields({
  meeting,
  onChange,
  variant = 'dialog',
}: {
  meeting: Meeting;
  onChange: (patch: Partial<Meeting>) => void;
  variant?: 'page' | 'dialog';
}) {
  const dateISO = toDateISO(meeting.start);

  const setDate = (iso: string) => {
    if (!iso) return;
    const start = combineDateTime(iso, toHM(meeting.start));
    const end = combineDateTime(iso, toHM(meeting.end));
    if (start != null && end != null) onChange({ start, end: Math.max(end, start) });
  };
  const setStartTime = (hm: string) => {
    const start = combineDateTime(dateISO, hm);
    if (start != null) onChange({ start, end: Math.max(meeting.end, start) });
  };
  const setEndTime = (hm: string) => {
    const end = combineDateTime(dateISO, hm);
    if (end != null) onChange({ end: Math.max(end, meeting.start) });
  };

  const duration = formatDuration(meetingDurationMs(meeting));

  // ── compact stack (dialog) ─────────────────────────────────────────────────
  if (variant === 'dialog') {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Title</Label>
          <Input value={meeting.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Weekly sync…" className="h-9 text-sm" />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Date</Label>
            <DatePicker value={dateISO} onChange={setDate} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Start</Label>
            <TimePicker value={toHM(meeting.start)} onChange={setStartTime} className="h-9 w-[94px]" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">End</Label>
            <TimePicker value={toHM(meeting.end)} onChange={setEndTime} className="h-9 w-[94px]" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Duration</Label>
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-2.5 text-sm font-medium tabular-nums">{duration}</div>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Participants <span className="text-muted-foreground/60">— commas or new lines</span></Label>
          <Textarea value={meeting.participants} onChange={(e) => onChange({ participants: e.target.value })} placeholder="Alice, Bob, Carol" className="min-h-[44px] resize-y text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Agenda &amp; Discussion</Label>
          <Textarea value={meeting.agenda} onChange={(e) => onChange({ agenda: e.target.value })} placeholder={'Reviewed Q2 roadmap'} className="min-h-[72px] resize-y text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Decisions</Label>
          <Textarea value={meeting.decisions} onChange={(e) => onChange({ decisions: e.target.value })} placeholder={'Ship v2 on June 30'} className="min-h-[56px] resize-y text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Action Items</Label>
          <Textarea value={meeting.actions} onChange={(e) => onChange({ actions: e.target.value })} placeholder={'Alice: draft the spec'} className="min-h-[56px] resize-y text-sm" />
        </div>
      </div>
    );
  }

  // ── spacious page layout ────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Title — prominent, underlined */}
      <Input
        value={meeting.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="Untitled meeting"
        className="h-auto rounded-none border-0 border-b bg-transparent px-0 py-1.5 text-lg font-semibold shadow-none focus-visible:ring-0"
      />

      {/* Meta bar — when / who in one compact card */}
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-lg border bg-muted/20 p-3.5">
        <MetaField label="Date">
          <DatePicker value={dateISO} onChange={setDate} className="h-9 w-[150px]" />
        </MetaField>
        <MetaField label="Start">
          <TimePicker value={toHM(meeting.start)} onChange={setStartTime} className="h-9 w-[94px]" />
        </MetaField>
        <MetaField label="End">
          <TimePicker value={toHM(meeting.end)} onChange={setEndTime} className="h-9 w-[94px]" />
        </MetaField>
        <MetaField label="Duration">
          <div className="flex h-9 items-center rounded-md bg-foreground/5 px-3 text-sm font-semibold tabular-nums">{duration}</div>
        </MetaField>
        <div className="min-w-[200px] flex-1">
          <MetaField label="Participants" icon={Users}>
            <Input
              value={meeting.participants}
              onChange={(e) => onChange({ participants: e.target.value })}
              placeholder="Alice, Bob, Carol"
              className="h-9 text-sm"
            />
          </MetaField>
        </div>
      </div>

      {/* Agenda — full width */}
      <Section icon={MessageSquare} title="Agenda & Discussion" hint="one point per line">
        <Textarea
          value={meeting.agenda}
          onChange={(e) => onChange({ agenda: e.target.value })}
          placeholder={'Reviewed Q2 roadmap\nDiscussed onboarding flow\nBudget for new hires'}
          className="min-h-[150px] resize-y text-sm leading-relaxed"
        />
      </Section>

      {/* Decisions + actions — side by side on wider editors */}
      <div className="grid gap-5 md:grid-cols-2">
        <Section icon={Gavel} title="Decisions" hint="one per line">
          <Textarea
            value={meeting.decisions}
            onChange={(e) => onChange({ decisions: e.target.value })}
            placeholder={'Ship v2 on June 30\nAdopt trunk-based development'}
            className="min-h-[130px] resize-y text-sm leading-relaxed"
          />
        </Section>
        <Section icon={ListChecks} title="Action Items" hint="one task per line · checkboxes">
          <Textarea
            value={meeting.actions}
            onChange={(e) => onChange({ actions: e.target.value })}
            placeholder={'Alice: draft the spec by Fri\nBob: set up CI pipeline'}
            className="min-h-[130px] resize-y text-sm leading-relaxed"
          />
        </Section>
      </div>
    </div>
  );
}

function MetaField({ label, icon: Icon, children }: { label: string; icon?: typeof Users; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </Label>
      {children}
    </div>
  );
}

function Section({ icon: Icon, title, hint, children, className }: {
  icon: typeof Users;
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold">{title}</span>
        {hint && <span className="text-[11px] text-muted-foreground/60">— {hint}</span>}
      </div>
      {children}
    </div>
  );
}
