// Request call history: a searchable list of past sends on the left, and the
// selected entry's full request *and* response on the right.
//
// Layout rule that shapes this file: the request detail and the response are
// two exclusive tabs, never stacked. They used to share one column — the
// request sat in a `<details>` above the response with no height cap, so
// expanding it on a request with a dozen headers and a long Cookie pushed the
// response out of the pane entirely. Tabs give each side the whole column and
// its own scroll, so neither can crowd the other out however big it gets.

import { useMemo, useState } from 'react';
import { ArrowUpRight, Clock, Eraser, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CopyButton } from '@/components/ui/copy-button';
import { IconButton } from '@/components/ui/icon-button';
import { SearchInput } from '@/components/ui/search-input';
import { SectionLabel } from '@/components/ui/section-label';
import { Segmented } from '@/components/ui/segmented';
import { SplitPane } from '@/components/ui/split-pane';
import { methodColor } from './method-color';
import { statusColor } from './request';
import { ResponsePanel } from './ResponsePanel';
import type { ApiStore } from './store';
import { type ApiRequest, type HistoryEntry, type KeyValue, normalizeRequest, uid } from './types';

// ─── formatting ─────────────────────────────────────────────────────────────

// hour12:false deliberately — this is a log column of fixed width, and the
// locale 12-hour form ("04:24:53 PM") wrapped onto a second line, leaving every
// row a different height.
const clock = (ts: number) =>
  new Date(ts).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

const startOfDay = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

// "Today" / "Yesterday" / a full date — the heading over each day's group.
function dayLabel(ts: number): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(ts);
  const diff = Math.round((today - day) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

const fmtDuration = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

// Split a URL into a dimmable origin and the part that actually identifies the
// call. Falls back to putting everything in `path` for a URL we can't parse
// (a `{{baseUrl}}` template, say) rather than dropping it.
function splitUrl(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return { host: u.host, path: `${u.pathname}${u.search}` || '/' };
  } catch {
    return { host: '', path: url };
  }
}

// ─── list ───────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'ok' | 'failed';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ok', label: 'OK' },
  { value: 'failed', label: 'Failed' },
];

const matchesFilter = (h: HistoryEntry, f: StatusFilter) =>
  f === 'all' ? true : f === 'ok' ? (h.ok && !h.error) : (!!h.error || !h.ok);

function matchesQuery(h: HistoryEntry, q: string): boolean {
  if (!q) return true;
  return h.url.toLowerCase().includes(q)
    || h.method.toLowerCase().includes(q)
    || String(h.status).includes(q)
    || (h.error ?? '').toLowerCase().includes(q);
}

interface Props {
  store: ApiStore;
  /** Leaves the history view — used after restoring an entry into a tab. */
  onExit?: () => void;
}

export function HistoryView({ store, onExit }: Props) {
  const { history } = store;
  const [selectedId, setSelectedId] = useState<string | null>(history[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => history.filter((h) => matchesFilter(h, filter) && matchesQuery(h, q)),
    [history, filter, q],
  );

  // Group the (already newest-first) list by calendar day, preserving order.
  const groups = useMemo(() => {
    const out: { day: number; label: string; entries: HistoryEntry[] }[] = [];
    for (const h of visible) {
      const day = startOfDay(h.at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.entries.push(h);
      else out.push({ day, label: dayLabel(h.at), entries: [h] });
    }
    return out;
  }, [visible]);

  // Keep the selection on something that is actually on screen.
  const selected = visible.find((h) => h.id === selectedId) ?? visible[0] ?? null;

  const list = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <SectionLabel className="min-w-0" count={history.length}>
          <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> History</span>
        </SectionLabel>
        <IconButton
          size="xs"
          onClick={() => store.clearHistory()}
          disabled={history.length === 0}
          title="Clear history"
          className="hover:text-bad"
        >
          <Eraser className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      {/* Filters — the list is capped at the last 50 sends and a single endpoint
          under test fills it, so finding one call meant scrolling past its
          neighbours. */}
      <div className="flex shrink-0 flex-col gap-1.5 border-b px-3 py-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Search URL, method, status" className="h-ctl text-xs" />
        <Segmented value={filter} onValueChange={setFilter} options={STATUS_FILTERS} size="sm" aria-label="Filter by outcome" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {history.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-fg-mute">No requests sent yet.</p>
        ) : visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-fg-mute">
            No sends match this search.
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.day}>
              <div className="sticky top-0 z-10 border-b bg-bg/95 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-mute/70 backdrop-blur">
                {g.label}
              </div>
              {g.entries.map((h, i) => (
                <HistoryRow
                  key={h.id}
                  entry={h}
                  // The URL column is ~230px at the default split, not enough for
                  // host and path both. A run of calls against one host repeats
                  // it on every line and starves the path — the only part that
                  // tells two rows apart — so the host prints on the first row
                  // of a day and then only when it changes.
                  showHost={i === 0 || splitUrl(g.entries[i - 1].url).host !== splitUrl(h.url).host}
                  selected={selected?.id === h.id}
                  onClick={() => setSelectedId(h.id)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SplitPane
        direction="horizontal"
        minPanePx={340}
        first={list}
        second={
          selected ? (
            <HistoryDetail key={selected.id} entry={selected} store={store} onExit={onExit} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-xs text-fg-mute">
              Select a send to inspect its request and response.
            </div>
          )
        }
      />
    </div>
  );
}

function HistoryRow({ entry, showHost, selected, onClick }: {
  entry: HistoryEntry; showHost: boolean; selected: boolean; onClick: () => void;
}) {
  const { host, path } = splitUrl(entry.url);
  // The muted greys that carry these columns on the panel background drop below
  // AA once the row is filled with solid accent, so the selected row gets its
  // own pair rather than reusing them.
  const secondary = selected ? 'text-fg/75' : 'text-fg-mute/75';
  const tertiary = selected ? 'text-fg/60' : 'text-fg-mute/50';
  return (
    <button
      onClick={onClick}
      title={entry.url}
      className={cn(
        'flex w-full items-center gap-2.5 border-b border-line/40 px-3 py-2 text-left text-xs transition-colors',
        selected ? 'bg-acc' : 'hover:bg-acc/40',
      )}
    >
      <span className={cn('w-14 shrink-0 font-mono text-[11px] tabular-nums', secondary)}>{clock(entry.at)}</span>
      <span className={cn('w-12 shrink-0 text-[11px] font-bold uppercase', methodColor(entry.method))}>
        {entry.method}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline font-mono">
        {host && showHost && <span className={cn('max-w-[45%] shrink-0 truncate', tertiary)}>{host}</span>}
        <span className="min-w-0 flex-1 truncate">{path}</span>
      </span>
      <span className={cn('shrink-0 text-[11px] tabular-nums', tertiary)}>{fmtDuration(entry.timeMs)}</span>
      <span className={cn('w-8 shrink-0 text-right font-semibold', entry.error ? 'text-bad' : statusColor(entry.status))}>
        {entry.error ? 'ERR' : entry.status}
      </span>
    </button>
  );
}

// ─── detail ─────────────────────────────────────────────────────────────────

type DetailTab = 'request' | 'response';

function HistoryDetail({ entry, store, onExit }: {
  entry: HistoryEntry; store: ApiStore; onExit?: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>('response');

  // Restoring a past send into an editable tab — the one thing you always want
  // from a history entry and previously had to rebuild by hand.
  const targetCollectionId = store.activeCollectionId ?? store.collections[0]?.id ?? null;
  const restore = () => {
    if (!entry.request || !targetCollectionId) return;
    // Name it after the path only: the tab strip and the tree already print the
    // method beside the name, and the query string is in the request itself.
    const { path } = splitUrl(entry.url);
    const name = path.split('?')[0] || entry.url;
    store.addRequest(targetCollectionId, {
      ...normalizeRequest(entry.request),
      id: uid(),
      name: name.slice(0, 80),
    });
    onExit?.();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={cn('shrink-0 text-[11px] font-bold uppercase', methodColor(entry.method))}>{entry.method}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={entry.url}>{entry.url}</span>
          <CopyButton value={entry.url} icon={Link2} title="Copy URL" iconClassName="h-3.5 w-3.5" />
          <IconButton
            size="xs"
            onClick={restore}
            disabled={!entry.request || !targetCollectionId}
            title={
              !entry.request ? 'This entry has no saved request'
                : !targetCollectionId ? 'Create a collection first'
                  : 'Open as a new request'
            }
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        {/* A Segmented, not a second Tabs strip: ResponsePanel brings its own
            tab row (Body / Headers / Timeline / …), and stacking two rows of
            tabs made it ambiguous which one the click would act on. A pill
            switch reads as the mode control it is, and shares this line with
            the metadata instead of taking a row of its own. */}
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-fg-mute">
            <span className="shrink-0">{new Date(entry.at).toLocaleString()}</span>
            <span aria-hidden>·</span>
            <span className={cn('shrink-0 font-semibold', entry.error ? 'text-bad' : statusColor(entry.status))}>
              {entry.error ? 'Failed' : `${entry.status} ${entry.response?.statusText ?? ''}`.trim()}
            </span>
            <span aria-hidden>·</span>
            <span className="shrink-0">{fmtDuration(entry.timeMs)}</span>
          </div>
          <Segmented
            value={tab}
            onValueChange={setTab}
            options={[{ value: 'request', label: 'Request' }, { value: 'response', label: 'Response' }]}
            size="sm"
            className="shrink-0"
            aria-label="Show request or response"
          />
        </div>
      </div>

      {tab === 'request' ? (
        <RequestDetail entry={entry} />
      ) : entry.response || entry.error ? (
        <ResponsePanel
          response={entry.response ?? null}
          sending={false}
          error={entry.error ?? null}
          tests={entry.tests ?? []}
          logs={entry.logs ?? []}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-fg-mute">
          No response was captured for this entry.
        </div>
      )}
    </div>
  );
}

// Everything that was sent, laid out the same way in every section instead of
// the old ad-hoc label/value dump.
function RequestDetail({ entry }: { entry: HistoryEntry }) {
  const req = entry.request;

  const query = useMemo(() => {
    try {
      return [...new URL(entry.url).searchParams.entries()].map(([k, v]) => ({ id: `q-${k}-${v}`, key: k, value: v }));
    } catch {
      return [];
    }
  }, [entry.url]);

  if (!req) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-fg-mute">
        This entry predates request capture, so only its response was kept.
      </div>
    );
  }

  const enabled = (rows: KeyValue[]) => rows.filter((r) => r.enabled && r.key);
  const headers = enabled(req.headers ?? []);
  const pathParams = enabled(req.pathParams ?? []);
  const body = bodyText(req);
  const finalUrl = entry.response?.url && entry.response.url !== entry.url ? entry.response.url : null;

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
      <Section title="General">
        <DetailTable rows={[
          { id: 'method', key: 'Method', value: req.method },
          { id: 'url', key: 'URL', value: entry.url },
          ...(finalUrl ? [{ id: 'final', key: 'Final URL', value: finalUrl }] : []),
          { id: 'auth', key: 'Auth', value: authSummary(req) },
        ]} />
      </Section>

      {query.length > 0 && (
        <Section title="Query" count={query.length}>
          <DetailTable rows={query} />
        </Section>
      )}

      {pathParams.length > 0 && (
        <Section title="Path" count={pathParams.length}>
          <DetailTable rows={pathParams.map((p) => ({ id: p.id, key: `:${p.key}`, value: p.value }))} />
        </Section>
      )}

      <Section
        title="Headers"
        count={headers.length}
        actions={headers.length > 0 && (
          <CopyButton value={() => headers.map((h) => `${h.key}: ${h.value}`).join('\n')} title="Copy headers" iconClassName="h-3 w-3" />
        )}
      >
        {headers.length > 0
          ? <DetailTable rows={headers} />
          : <Empty>No headers were sent.</Empty>}
      </Section>

      <Section
        title="Body"
        actions={body && <CopyButton value={body} title="Copy body" iconClassName="h-3 w-3" />}
      >
        {body ? (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border bg-bg-2/30 p-2.5 font-mono text-[11px] leading-relaxed">
            {body}
          </pre>
        ) : (
          <Empty>No body was sent.</Empty>
        )}
      </Section>
    </div>
  );
}

function Section({ title, count, actions, children }: {
  title: string; count?: number; actions?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <SectionLabel count={count} actions={actions || undefined}>{title}</SectionLabel>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-md border border-dashed px-2.5 py-2 text-[11px] text-fg-mute/70">{children}</p>
);

// `minmax(0, …)` on both tracks: a header value like a full Cookie has no
// natural break, and a bare `1fr`'s auto floor would let it push the name
// column to nothing (see KeyValueEditor for the same rule).
function DetailTable({ rows }: { rows: { id: string; key: string; value: string }[] }) {
  return (
    <div className="overflow-hidden rounded-md border text-xs">
      {rows.map((r, i) => (
        <div key={r.id} className={cn('grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)]', i > 0 && 'border-t')}>
          <div className="min-w-0 break-words border-r bg-bg-2/25 px-2.5 py-1.5 font-medium text-fg-mute">{r.key}</div>
          <div className="min-w-0 whitespace-pre-wrap break-all px-2.5 py-1.5 font-mono">
            {r.value || <span className="text-fg-mute/50">(empty)</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// A one-line description of the auth that was attached — never the credential
// itself, which history deliberately does not keep in the clear.
function authSummary(req: ApiRequest): string {
  switch (req.auth?.type) {
    case 'bearer': return 'Bearer token';
    case 'basic': return `Basic — ${req.auth.username || '(no username)'}`;
    case 'digest': return `Digest — ${req.auth.username || '(no username)'}`;
    case 'apikey': return `API key — ${req.auth.apiKey.key || '(unnamed)'} in ${req.auth.apiKey.placement}`;
    case 'oauth2': return `OAuth2 — ${req.auth.oauth2.grantType}`;
    case 'inherit': return 'Inherited from the parent folder or collection';
    default: return 'None';
  }
}

function bodyText(req: ApiRequest): string {
  const b = req.body;
  if (!b || b.mode === 'none') return '';
  if (b.mode === 'graphql') {
    return [b.graphql?.query, b.graphql?.variables && `\n# variables\n${b.graphql.variables}`]
      .filter(Boolean).join('\n');
  }
  if (b.mode === 'multipart' || b.mode === 'urlencoded') {
    return (b.form ?? []).filter((f) => f.enabled && f.key)
      .map((f) => `${f.key} = ${f.kind === 'file' ? `(file) ${f.fileName ?? ''}` : f.value}`)
      .join('\n');
  }
  if (b.mode === 'file') return `(file) ${b.fileName ?? ''}`;
  return b.raw ?? '';
}
