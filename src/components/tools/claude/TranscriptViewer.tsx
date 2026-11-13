import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from 'lucide-react';
import {
  Badge, Button, Callout, CollapsibleSection, CopyButton, LoadingRow, ModalShell, SearchInput, Switch, cn,
} from '@/design-system';
import { useMessages } from '@/contexts/LocaleContext';
import { usePluginSdkFor } from '@/platform';
import MESSAGES from './ClaudeManager.messages';
import { projectName, resumeCommand, shortModel, type Profile, type SessionRow } from './usage';

type M = ReturnType<typeof useMessages<typeof MESSAGES>>;

/** Mirrors `Entry` in src-tauri/src/claude_transcript.rs. */
export interface TranscriptEntry {
  index: number;
  kind: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'meta';
  ts: number | null;
  text: string;
  truncated: boolean;
  tool: string | null;
  model: string | null;
}

interface TranscriptPage {
  entries: TranscriptEntry[];
  start: number;
  total: number;
}

export interface TranscriptTarget {
  session: SessionRow;
  /** Entry to open at (a search hit); the end of the session otherwise. */
  around?: number;
}

const isConversation = (e: TranscriptEntry) => e.kind === 'user' || e.kind === 'assistant';

function EntryView({ entry, highlighted, m }: { entry: TranscriptEntry; highlighted: boolean; m: M }) {
  const time = entry.ts === null ? '' : new Date(entry.ts).toLocaleString();
  const cut = entry.truncated && <p className="mt-1 text-[11px] text-fg-mute">{m('entryTruncated')}</p>;

  if (!isConversation(entry)) {
    const title = entry.kind === 'tool_use'
      ? `${m('toolCall')} · ${entry.tool || '?'}`
      : entry.kind === 'tool_result' ? m('toolResult') : m('harnessMessage');
    return (
      <div data-entry={entry.index} className="pl-4">
        <CollapsibleSection title={title} hint={time} variant="bordered">
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{entry.text}</pre>
          {cut}
        </CollapsibleSection>
      </div>
    );
  }

  const mine = entry.kind === 'user';
  return (
    <div
      data-entry={entry.index}
      className={cn(
        'rounded-md border px-3 py-2 transition-shadow',
        mine ? 'border-acc-edge bg-acc-tint' : 'border-line bg-card',
        highlighted && 'ring-2 ring-focus',
      )}
    >
      <div className="mb-1 flex items-center gap-2 text-[11px] text-fg-mute">
        <span className="font-semibold text-fg">{mine ? m('roleYou') : m('roleClaude')}</span>
        {!mine && entry.model && <Badge mono>{shortModel(entry.model)}</Badge>}
        <span>{time}</span>
      </div>
      <div className="whitespace-pre-wrap break-words text-sm">{entry.text}</div>
      {cut}
    </div>
  );
}

export function TranscriptViewer({ target, profile, onClose }: {
  target: TranscriptTarget;
  profile: Profile;
  onClose: () => void;
}) {
  const m = useMessages(MESSAGES);
  const sdk = usePluginSdkFor('claude-manager');
  const { session, around } = target;
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [filter, setFilter] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const placed = useRef(false);

  const load = useCallback(async (at: { before?: number; from?: number; around?: number } | null) => {
    setLoading(true);
    try {
      const page = await sdk.native.invoke<TranscriptPage>('claude_monitor_transcript', {
        dir: profile.configDir, project: session.project, session: session.id, at,
      });
      setTotal(page.total);
      setEntries((current) => {
        if (at?.before !== undefined) return [...page.entries, ...current];
        if (at?.from !== undefined) return [...current, ...page.entries];
        return page.entries;
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sdk, profile.configDir, session.project, session.id]);

  useEffect(() => {
    placed.current = false;
    void load(around === undefined ? null : { around });
  }, [load, around]);

  // First paint only: jump to the search hit, or to the latest message.
  useEffect(() => {
    const list = listRef.current;
    if (!list || placed.current || entries.length === 0) return;
    placed.current = true;
    if (around === undefined) list.scrollTop = list.scrollHeight;
    else list.querySelector(`[data-entry="${around}"]`)?.scrollIntoView({ block: 'center' });
  }, [entries, around]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return entries.filter((e) =>
      (showTools || isConversation(e)) && (!q || e.text.toLowerCase().includes(q) || e.tool?.toLowerCase().includes(q)));
  }, [entries, showTools, filter]);

  const first = entries[0]?.index ?? 0;
  const next = entries.length > 0 ? entries[entries.length - 1].index + 1 : 0;

  return (
    <ModalShell
      onClose={onClose}
      title={session.title ?? m('untitled')}
      description={[projectName(session), session.gitBranch, profile.label].filter(Boolean).join(' · ')}
      width="max-w-4xl"
      bodyClassName="flex min-h-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={filter}
          onChange={setFilter}
          placeholder={m('filterTranscript')}
          containerClassName="min-w-[12rem] flex-1"
        />
        <label className="flex items-center gap-1.5 text-xs text-fg-mute">
          <Switch checked={showTools} onCheckedChange={setShowTools} aria-label={m('showTools')} />
          {m('showTools')}
        </label>
        <CopyButton
          value={() => resumeCommand(session, profile)}
          icon={Terminal}
          label={m('copyResumeShort')}
          variant="outline"
          size="sm"
        />
      </div>
      {error && <Callout tone="error" size="sm">{error}</Callout>}

      <div ref={listRef} className="min-h-[16rem] flex-1 space-y-2 overflow-y-auto pr-1" style={{ maxHeight: '62vh' }}>
        {first > 0 && (
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void load({ before: first })}>
            {m('loadEarlier', { count: first })}
          </Button>
        )}
        {visible.map((entry) => (
          <EntryView key={entry.index} entry={entry} highlighted={entry.index === around} m={m} />
        ))}
        {loading && <LoadingRow label={m('loadingTranscript')} />}
        {!loading && !error && visible.length === 0 && (
          <p className="text-sm text-fg-mute">{entries.length === 0 ? m('emptyTranscript') : m('noMatch')}</p>
        )}
        {next < total && (
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void load({ from: next })}>
            {m('loadLater', { count: total - next })}
          </Button>
        )}
      </div>
    </ModalShell>
  );
}
