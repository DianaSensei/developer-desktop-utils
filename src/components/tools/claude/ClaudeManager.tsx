import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, FolderOpen, FolderSearch, Plus, RefreshCw, Terminal, Trash2 } from 'lucide-react';
import {
  Badge, Button, Callout, ConfirmDialog, CopyButton, DataTable, EmptyState, IconButton, Input, LoadingRow,
  SearchInput, SectionLabel, Segmented, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Stat,
  StatGrid, StatusDot, Switch, Tabs, Tbody, Td, Th, Thead, Tr, type BadgeTone, type StatusDotTone,
} from '@/design-system';
import { ToolToolbar } from '@/components/ui/tool-layout';
import { v4 as newId } from 'uuid';
import { useMessages } from '@/contexts/LocaleContext';
import { usePluginSdkFor, usePluginState, useToolActiveRef } from '@/platform';
import MESSAGES from './ClaudeManager.messages';
import {
  DEFAULT_PROFILE, formatCost, formatTokens, isRunning, lastFiveHoursStart, launchCommand,
  projectName, rangeStartHour, resumeCommand, sessionModels, sessionStatus, sessionTotals, shortModel,
  totalUsage, uniqueLabel, usageByDay, usageByModel, usageByProfile, usageByProject,
  type Detected, type Profile, type ProfileSnapshot, type RangeId, type SessionRow, type SessionStatus, type UsageGroup,
  type UsageTotals,
} from './usage';

const PLUGIN_ID = 'claude-manager';
const POLL_MS = 5000;
const PAGE_SIZE = 100;
const RECENT_COUNT = 8;

type TabId = 'overview' | 'sessions' | 'usage' | 'accounts';
type StatusFilter = 'all' | 'running' | 'ended';
type M = ReturnType<typeof useMessages<typeof MESSAGES>>;

const STATUS_DOT: Record<SessionStatus, StatusDotTone> = {
  // Idle is still a live process: same dot as working, without the pulse.
  working: 'live', waiting: 'starting', idle: 'live', ended: 'idle',
};
const STATUS_BADGE: Record<SessionStatus, BadgeTone> = {
  working: 'success', waiting: 'warning', idle: 'neutral', ended: 'neutral',
};
const STATUS_LABEL = {
  working: 'statusWorking', waiting: 'statusWaiting', idle: 'statusIdle', ended: 'statusEnded',
} as const;

// ── Data ─────────────────────────────────────────────────────────────────

function useClaudeScan(profiles: Profile[], auto: boolean) {
  const sdk = usePluginSdkFor(PLUGIN_ID);
  const activeRef = useToolActiveRef();
  const [snapshots, setSnapshots] = useState<ProfileSnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scannedAt, setScannedAt] = useState(() => Date.now());
  const inFlight = useRef(false);
  const dirs = useMemo(() => profiles.map((p) => p.configDir), [profiles]);

  const refresh = useCallback(async () => {
    if (!sdk.env.isTauri || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      setSnapshots(await sdk.native.invoke<ProfileSnapshot[]>('claude_monitor_scan', { dirs }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
      setScannedAt(Date.now());
    }
  }, [sdk, dirs]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!auto) return;
    // Kept tools stay mounted in the background; only the one in front polls.
    const timer = setInterval(() => {
      if (activeRef.current && document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [auto, refresh, activeRef]);

  return { snapshots, error, busy, scannedAt, refresh };
}

// ── Small pieces ─────────────────────────────────────────────────────────

function timeAgo(m: M, at: number | null, now: number): string {
  if (at === null) return '—';
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return m('justNow');
  if (minutes < 60) return m('minutesAgo', { n: minutes });
  if (minutes < 60 * 24) return m('hoursAgo', { n: Math.floor(minutes / 60) });
  return m('daysAgo', { n: Math.floor(minutes / (60 * 24)) });
}

function StatusBadge({ status, m }: { status: SessionStatus; m: M }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <StatusDot tone={STATUS_DOT[status]} pulse={status === 'working'} />
      <Badge tone={STATUS_BADGE[status]} uppercase>{m(STATUS_LABEL[status])}</Badge>
    </span>
  );
}

function CostCell({ totals }: { totals: UsageTotals }) {
  return <>{totals.cost === 0 && totals.unpriced > 0 ? '—' : formatCost(totals.cost)}</>;
}

interface SessionTableProps {
  rows: SessionRow[];
  profiles: Profile[];
  fromHour: number;
  now: number;
  m: M;
}

function SessionTable({ rows, profiles, fromHour, now, m }: SessionTableProps) {
  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const showAccount = profiles.length > 1;
  return (
    <DataTable>
      <Thead>
        <Tr>
          <Th>{m('colSession')}</Th>
          <Th>{m('colProject')}</Th>
          {showAccount && <Th>{m('colAccount')}</Th>}
          <Th>{m('colModel')}</Th>
          <Th>{m('colActivity')}</Th>
          <Th align="right">{m('colTokens')}</Th>
          <Th align="right">{m('colCost')}</Th>
          <Th />
        </Tr>
      </Thead>
      <Tbody>
        {rows.map((s) => {
          const status = sessionStatus(s, now);
          const totals = sessionTotals(s, fromHour);
          const profile = profileById.get(s.profileId) ?? DEFAULT_PROFILE;
          const models = sessionModels(s);
          const details = [
            s.gitBranch,
            m('prompts', { count: s.prompts }),
            s.subagents > 0 ? m('subagents', { count: s.subagents }) : null,
            s.live ? m('pid', { pid: s.live.pid }) : null,
          ].filter(Boolean).join(' · ');
          return (
            <Tr key={`${s.profileId}:${s.id}`}>
              <Td className="max-w-0 w-[40%]">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusBadge status={status} m={m} />
                  <span className="truncate font-medium" title={s.title ?? undefined}>
                    {s.title ?? s.live?.name ?? m('untitled')}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-fg-mute">{details}</div>
              </Td>
              <Td className="max-w-[14rem] truncate" title={s.cwd ?? undefined}>{projectName(s)}</Td>
              {showAccount && <Td className="whitespace-nowrap">{profile.label}</Td>}
              <Td mono className="whitespace-nowrap">
                {models.length === 0 ? '—' : shortModel(models[0])}
                {models.length > 1 && <span className="text-fg-mute"> +{models.length - 1}</span>}
              </Td>
              <Td className="whitespace-nowrap text-fg-mute">{timeAgo(m, s.lastActivityAt, now)}</Td>
              <Td numeric>{formatTokens(totals.tokens)}</Td>
              <Td numeric><CostCell totals={totals} /></Td>
              <Td align="right">
                <CopyButton
                  value={() => resumeCommand(s, profile)}
                  icon={Terminal}
                  title={m('copyResume')}
                  aria-label={m('copyResume')}
                  iconClassName="h-3.5 w-3.5"
                />
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </DataTable>
  );
}

function UsageTable({ title, keyLabel, groups, total, formatKey, mono = true, m }: {
  title: string;
  keyLabel: string;
  groups: UsageGroup[];
  total: number;
  formatKey?: (key: string) => string;
  /** Identifiers (model ids, dates, folders) read better in mono; names do not. */
  mono?: boolean;
  m: M;
}) {
  if (groups.length === 0) return null;
  return (
    <section className="space-y-2">
      <SectionLabel>{title}</SectionLabel>
      <DataTable density="compact">
        <Thead>
          <Tr>
            <Th>{keyLabel}</Th>
            <Th className="w-[28%]">{m('colShare')}</Th>
            <Th align="right">{m('statInput')}</Th>
            <Th align="right">{m('statOutput')}</Th>
            <Th align="right">{m('statCacheWrite')}</Th>
            <Th align="right">{m('statCacheRead')}</Th>
            <Th align="right">{m('colRequests')}</Th>
            <Th align="right">{m('colTokens')}</Th>
            <Th align="right">{m('colCost')}</Th>
          </Tr>
        </Thead>
        <Tbody>
          {groups.map(({ key, totals }) => {
            const share = total > 0 ? (totals.tokens / total) * 100 : 0;
            return (
              <Tr key={key}>
                <Td mono={mono} className="whitespace-nowrap">{formatKey ? formatKey(key) : key}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-2">
                      <div className="h-full rounded-full bg-acc transition-[width]" style={{ width: `${share}%` }} />
                    </div>
                    <span className="w-9 text-right text-[11px] tabular-nums text-fg-mute">{share.toFixed(0)}%</span>
                  </div>
                </Td>
                <Td numeric>{formatTokens(totals.input)}</Td>
                <Td numeric>{formatTokens(totals.output)}</Td>
                <Td numeric>{formatTokens(totals.cacheWrite)}</Td>
                <Td numeric>{formatTokens(totals.cacheRead)}</Td>
                <Td numeric>{totals.requests.toLocaleString()}</Td>
                <Td numeric>{formatTokens(totals.tokens)}</Td>
                <Td numeric><CostCell totals={totals} /></Td>
              </Tr>
            );
          })}
        </Tbody>
      </DataTable>
    </section>
  );
}

// ── Views ────────────────────────────────────────────────────────────────

interface ViewProps {
  rows: SessionRow[];
  profiles: Profile[];
  fromHour: number;
  now: number;
  m: M;
}

function OverviewView({ rows, profiles, fromHour, now, m }: ViewProps) {
  const statuses = useMemo(() => rows.map((s) => sessionStatus(s, now)), [rows, now]);
  const running = rows.filter((_, i) => isRunning(statuses[i]));
  const recent = rows.filter((_, i) => !isRunning(statuses[i])).slice(0, RECENT_COUNT);
  const totals = useMemo(() => totalUsage(rows, fromHour), [rows, fromHour]);
  const window = useMemo(() => totalUsage(rows, lastFiveHoursStart(now)), [rows, now]);
  const count = (status: SessionStatus) => statuses.filter((s) => s === status).length;

  return (
    <>
      <StatGrid columns={4}>
        <Stat
          label={m('statRunning')}
          value={running.length}
          tone={running.length > 0 ? 'success' : 'muted'}
          sub={m('statRunningSub', { working: count('working'), waiting: count('waiting') })}
        />
        <Stat
          label={m('statTokens')}
          value={formatTokens(totals.tokens)}
          sub={m('statTokensSub', { requests: totals.requests.toLocaleString() })}
        />
        <Stat label={m('statCost')} value={formatCost(totals.cost)} sub={m('statCostSub')} />
        <Stat
          label={m('statWindow')}
          value={formatTokens(window.tokens)}
          sub={m('statWindowSub', { cost: formatCost(window.cost), requests: window.requests.toLocaleString() })}
        />
      </StatGrid>

      <section className="space-y-2">
        <SectionLabel count={running.length}>{m('runningNow')}</SectionLabel>
        {running.length === 0
          ? <p className="text-sm text-fg-mute">{m('nothingRunning')}</p>
          : <SessionTable rows={running} profiles={profiles} fromHour={0} now={now} m={m} />}
      </section>

      {recent.length > 0 && (
        <section className="space-y-2">
          <SectionLabel>{m('recentSessions')}</SectionLabel>
          <SessionTable rows={recent} profiles={profiles} fromHour={0} now={now} m={m} />
        </section>
      )}
    </>
  );
}

function SessionsView({ rows, profiles, fromHour, now, m }: ViewProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((s) => {
      if (filter !== 'all' && isRunning(sessionStatus(s, now)) !== (filter === 'running')) return false;
      if (!q) return true;
      return [s.title, s.cwd, s.gitBranch, s.id, s.live?.name]
        .some((field) => field?.toLowerCase().includes(q));
    });
  }, [rows, query, filter, now]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={m('searchSessions')}
          containerClassName="min-w-[14rem] flex-1"
        />
        <Segmented
          value={filter}
          onValueChange={setFilter}
          aria-label={m('statusFilter')}
          options={[
            { value: 'all', label: m('filterAll') },
            { value: 'running', label: m('filterRunning') },
            { value: 'ended', label: m('filterEnded') },
          ]}
        />
        <Badge pill>{matched.length}</Badge>
      </div>
      {matched.length === 0
        ? <p className="text-sm text-fg-mute">{m('noMatch')}</p>
        : <SessionTable rows={matched.slice(0, limit)} profiles={profiles} fromHour={fromHour} now={now} m={m} />}
      {matched.length > limit && (
        <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
          {m('showMore', { count: Math.min(PAGE_SIZE, matched.length - limit) })}
        </Button>
      )}
    </>
  );
}

function UsageView({ rows, profiles, fromHour, m }: ViewProps) {
  const totals = useMemo(() => totalUsage(rows, fromHour), [rows, fromHour]);
  const byProfile = useMemo(() => {
    const map = usageByProfile(rows, fromHour);
    return profiles
      .filter((p) => map.has(p.id))
      .map((p) => ({ key: p.label, totals: map.get(p.id)! }));
  }, [rows, profiles, fromHour]);

  if (totals.requests === 0) return <p className="text-sm text-fg-mute">{m('noUsage')}</p>;
  const shared = { total: totals.tokens, m };
  return (
    <>
      <StatGrid columns={4}>
        <Stat label={m('statInput')} value={formatTokens(totals.input)} variant="compact" />
        <Stat label={m('statOutput')} value={formatTokens(totals.output)} variant="compact" />
        <Stat label={m('statCacheWrite')} value={formatTokens(totals.cacheWrite)} variant="compact" />
        <Stat label={m('statCacheRead')} value={formatTokens(totals.cacheRead)} variant="compact" />
      </StatGrid>
      <Callout tone="info" size="sm">
        {m('costNote')}
        {totals.unpriced > 0 && ` ${m('unpricedNote', { count: totals.unpriced })}`}
      </Callout>
      {byProfile.length > 1 && (
        <UsageTable title={m('byAccount')} keyLabel={m('colAccount')} groups={byProfile} mono={false} {...shared} />
      )}
      <UsageTable title={m('byModel')} keyLabel={m('colModel')} groups={usageByModel(rows, fromHour)} formatKey={shortModel} {...shared} />
      <UsageTable title={m('byProject')} keyLabel={m('colProject')} groups={usageByProject(rows, fromHour)} {...shared} />
      <UsageTable title={m('byDay')} keyLabel={m('colDay')} groups={usageByDay(rows, fromHour)} {...shared} />
    </>
  );
}

// ── Accounts ─────────────────────────────────────────────────────────────

const SOURCE_LABEL = {
  default: 'sourceDefault', env: 'sourceEnv', process: 'sourceProcess', scan: 'sourceScan', custom: 'sourceCustom',
} as const;

/**
 * Finds config directories on this machine. The first time the tool opens,
 * everything found is tracked straight away; after that, new finds are only
 * offered, so a directory the user removed does not come back by itself.
 */
function useAccountDetection(profiles: Profile[], setProfiles: (next: Profile[]) => void) {
  const sdk = usePluginSdkFor(PLUGIN_ID);
  const [autoDone, setAutoDone] = usePluginState(sdk, 'autoDetected', false);
  const [ignored, setIgnored] = usePluginState<string[]>(sdk, 'ignoredDirs', []);
  const [found, setFound] = useState<Detected[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const autoDoneRef = useRef(autoDone);
  autoDoneRef.current = autoDone;

  /** Tracks every valid, not-yet-tracked directory; returns how many. */
  const track = useCallback((items: Detected[], label?: string) => {
    const current = profilesRef.current;
    const fresh = items.filter((d) => d.valid && !current.some((p) => p.configDir === d.configDir));
    if (fresh.length === 0) return 0;
    const next = [...current];
    for (const d of fresh) {
      const wanted = fresh.length === 1 ? label?.trim() : '';
      next.push({ id: newId(), label: wanted || uniqueLabel(d.configDir, next.map((p) => p.label)), configDir: d.configDir });
    }
    profilesRef.current = next;
    setProfiles(next);
    setIgnored((dirs) => dirs.filter((dir) => !fresh.some((d) => d.configDir === dir)));
    return fresh.length;
  }, [setProfiles, setIgnored]);

  const detect = useCallback(async (roots?: string[]): Promise<Detected[]> => {
    setDetecting(true);
    try {
      const list = await sdk.native.invoke<Detected[]>('claude_monitor_detect', { roots: roots ?? null });
      setError(null);
      if (!roots) setFound(list);
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return [];
    } finally {
      setDetecting(false);
    }
  }, [sdk]);

  const started = useRef(false);
  useEffect(() => {
    if (!sdk.env.isTauri || started.current) return;
    started.current = true;
    void detect().then((list) => {
      if (autoDoneRef.current) return;
      setAutoDone(true);
      const valid = list.filter((d) => d.valid);
      if (valid.length === 0) return;
      // Claude Code is set up somewhere else on this machine: do not keep
      // an empty placeholder for the usual directory.
      if (!valid.some((d) => d.configDir === DEFAULT_PROFILE.configDir)) {
        profilesRef.current = profilesRef.current.filter((p) => p.configDir !== DEFAULT_PROFILE.configDir);
      }
      track(valid);
    });
  }, [sdk, detect, track, setAutoDone]);

  const untrack = useCallback((profile: Profile) => {
    const next = profilesRef.current.filter((p) => p.id !== profile.id);
    profilesRef.current = next;
    setProfiles(next);
    setIgnored((dirs) => [...new Set([...dirs, profile.configDir])]);
  }, [setProfiles, setIgnored]);

  const suggestions = useMemo(
    () => found.filter((d) =>
      d.valid && !ignored.includes(d.configDir) && !profiles.some((p) => p.configDir === d.configDir)),
    [found, ignored, profiles],
  );
  const hiddenCount = found.filter((d) => d.valid && ignored.includes(d.configDir)).length;

  return {
    suggestions, hiddenCount, detecting, error, detect, track, untrack,
    ignore: (d: Detected) => setIgnored((dirs) => [...new Set([...dirs, d.configDir])]),
    restoreIgnored: () => setIgnored([]),
  };
}

interface AccountsViewProps {
  profiles: Profile[];
  detection: ReturnType<typeof useAccountDetection>;
  snapshots: ProfileSnapshot[];
  allRows: SessionRow[];
  fromHour: number;
  m: M;
}

function AccountsView({ profiles, detection, snapshots, allRows, fromHour, m }: AccountsViewProps) {
  const sdk = usePluginSdkFor(PLUGIN_ID);
  const [label, setLabel] = useState('');
  const [dir, setDir] = useState('');
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [removing, setRemoving] = useState<Profile | null>(null);
  const usage = useMemo(() => usageByProfile(allRows, fromHour), [allRows, fromHour]);
  const { suggestions, hiddenCount, detecting, detect, track, untrack } = detection;

  /** Adds `path` if it is a config directory, or every one found below it. */
  const addPath = async (path: string) => {
    const root = path.trim();
    if (!root) return;
    const valid = (await detect([root])).filter((d) => d.valid);
    if (valid.length === 0) {
      setNotice({ tone: 'error', text: m('notConfigDir', { path: root }) });
      return;
    }
    const added = track(valid, label);
    setNotice(added === 0
      ? { tone: 'error', text: m('duplicateDir') }
      : { tone: 'info', text: m('addedSome', { count: added }) });
    if (added > 0) {
      setLabel('');
      setDir('');
    }
  };

  const browse = async () => {
    const picked = await sdk.files.pickOpen({ directory: true, title: m('browseTitle') });
    if (picked?.[0]) await addPath(picked[0]);
  };

  const rescan = async () => {
    const list = await detect();
    const fresh = list.filter((d) => d.valid && !profiles.some((p) => p.configDir === d.configDir));
    setNotice({ tone: 'info', text: fresh.length > 0 ? m('detectedSome', { count: fresh.length }) : m('detectedNone') });
  };

  return (
    <>
      <Callout tone="info" size="sm">{m('accountsIntro')}</Callout>
      <DataTable>
        <Thead>
          <Tr>
            <Th>{m('colAccount')}</Th>
            <Th>{m('colSignedIn')}</Th>
            <Th>{m('colDirectory')}</Th>
            <Th align="right">{m('colSessions')}</Th>
            <Th align="right">{m('colTokens')}</Th>
            <Th align="right">{m('colCost')}</Th>
            <Th />
          </Tr>
        </Thead>
        <Tbody>
          {profiles.map((p, i) => {
            const snap = snapshots[i];
            const totals = usage.get(p.id);
            return (
              <Tr key={p.id}>
                <Td className="font-medium whitespace-nowrap">{p.label}</Td>
                <Td>
                  {!snap?.exists
                    ? <Badge tone="danger">{m('dirMissing')}</Badge>
                    : snap.account?.email
                      ? (
                        <>
                          <div className="truncate">{snap.account.email}</div>
                          {snap.account.organization && (
                            <div className="truncate text-[11px] text-fg-mute">{snap.account.organization}</div>
                          )}
                        </>
                      )
                      : <span className="text-fg-mute">{m('notSignedIn')}</span>}
                </Td>
                <Td mono className="break-all">{p.configDir}</Td>
                <Td numeric>{snap?.sessions.length ?? 0}</Td>
                <Td numeric>{formatTokens(totals?.tokens ?? 0)}</Td>
                <Td numeric>{totals ? <CostCell totals={totals} /> : '$0'}</Td>
                <Td align="right" className="whitespace-nowrap">
                  <CopyButton
                    value={() => launchCommand(p)}
                    icon={Terminal}
                    title={m('copyLaunch')}
                    aria-label={m('copyLaunch')}
                    iconClassName="h-3.5 w-3.5"
                  />
                  <IconButton
                    title={m('remove')}
                    aria-label={m('remove')}
                    disabled={profiles.length === 1}
                    onClick={() => setRemoving(p)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </DataTable>

      {suggestions.length > 0 && (
        <section className="space-y-2">
          <SectionLabel
            count={suggestions.length}
            actions={(
              <Button size="sm" variant="outline" onClick={() => track(suggestions)}>{m('addAll')}</Button>
            )}
          >
            {m('foundOnMachine')}
          </SectionLabel>
          <DataTable density="compact">
            <Tbody>
              {suggestions.map((d) => (
                <Tr key={d.configDir}>
                  <Td mono className="break-all">{d.configDir}</Td>
                  <Td>{d.email ?? <span className="text-fg-mute">{m('notSignedIn')}</span>}</Td>
                  <Td className="whitespace-nowrap text-fg-mute">{m('sessionCount', { count: d.sessions })}</Td>
                  <Td><Badge>{m(SOURCE_LABEL[d.source])}</Badge></Td>
                  <Td align="right" className="whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => detection.ignore(d)}>{m('ignore')}</Button>
                    <Button size="sm" onClick={() => track([d])}>{m('add')}</Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </DataTable>
        </section>
      )}

      <section className="space-y-2">
        <SectionLabel>{m('addAccount')}</SectionLabel>
        <p className="text-[11px] text-fg-mute">{m('addHint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={m('labelPlaceholder')}
            aria-label={m('labelField')}
            className="w-40"
          />
          <Input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addPath(dir); }}
            placeholder={m('dirPlaceholder')}
            aria-label={m('dirField')}
            className="min-w-[14rem] flex-1 font-mono"
          />
          <Button size="sm" onClick={() => void addPath(dir)} disabled={!dir.trim() || detecting}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />{m('add')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void browse()} disabled={detecting}>
            <FolderOpen className="mr-1.5 h-3.5 w-3.5" />{m('browse')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void rescan()} disabled={detecting} title={m('detectHint')}>
            <FolderSearch className="mr-1.5 h-3.5 w-3.5" />{m('detect')}
          </Button>
        </div>
        {detection.error && <Callout tone="error" size="sm">{detection.error}</Callout>}
        {notice && <Callout tone={notice.tone} size="sm">{notice.text}</Callout>}
        {hiddenCount > 0 && (
          <p className="text-[11px] text-fg-mute">
            {m('ignoredCount', { count: hiddenCount })}{' '}
            <button type="button" className="underline hover:text-fg" onClick={detection.restoreIgnored}>
              {m('restoreIgnored')}
            </button>
          </p>
        )}
      </section>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null); }}
        title={m('removeTitle', { label: removing?.label ?? '' })}
        description={m('removeBody')}
        confirmLabel={m('remove')}
        onConfirm={() => {
          if (removing) untrack(removing);
          setRemoving(null);
        }}
      />
    </>
  );
}

// ── Tool ─────────────────────────────────────────────────────────────────

export function ClaudeManager() {
  const m = useMessages(MESSAGES);
  const sdk = usePluginSdkFor(PLUGIN_ID);
  const [profiles, setProfiles] = usePluginState<Profile[]>(sdk, 'profiles', [DEFAULT_PROFILE]);
  const [tab, setTab] = usePluginState<TabId>(sdk, 'tab', 'overview');
  const [range, setRange] = usePluginState<RangeId>(sdk, 'range', '7d');
  const [auto, setAuto] = usePluginState(sdk, 'autoRefresh', true);
  const [accountFilter, setAccountFilter] = useState('all');
  const { snapshots, error, busy, scannedAt, refresh } = useClaudeScan(profiles, auto);
  const detection = useAccountDetection(profiles, setProfiles);

  const allRows = useMemo<SessionRow[]>(() => {
    // Snapshots come back in the order the directories were sent.
    const rows = (snapshots ?? []).flatMap((snap, i) =>
      profiles[i] ? snap.sessions.map((s) => ({ ...s, profileId: profiles[i].id })) : []);
    return rows.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  }, [snapshots, profiles]);

  const activeFilter = profiles.some((p) => p.id === accountFilter) ? accountFilter : 'all';
  const rows = useMemo(
    () => (activeFilter === 'all' ? allRows : allRows.filter((s) => s.profileId === activeFilter)),
    [allRows, activeFilter],
  );
  const fromHour = useMemo(() => rangeStartHour(range, scannedAt), [range, scannedAt]);
  const runningCount = useMemo(
    () => rows.filter((s) => isRunning(sessionStatus(s, scannedAt))).length,
    [rows, scannedAt],
  );

  if (!sdk.env.isTauri) {
    return (
      <div className="tool-full-height">
        <div className="tool-padding"><Callout tone="info">{m('desktopOnly')}</Callout></div>
      </div>
    );
  }

  const view: ViewProps = { rows, profiles, fromHour, now: scannedAt, m };
  const tabs = [
    { id: 'overview', label: m('tabOverview') },
    { id: 'sessions', label: m('tabSessions'), badge: runningCount > 0 ? <Badge tone="success" pill>{runningCount}</Badge> : undefined },
    { id: 'usage', label: m('tabUsage') },
    { id: 'accounts', label: m('tabAccounts'), badge: detection.suggestions.length > 0
        ? <Badge tone="accent" pill>+{detection.suggestions.length}</Badge>
        : profiles.length > 1 ? <Badge pill>{profiles.length}</Badge> : undefined,
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <ToolToolbar className="flex flex-wrap items-center gap-2">
        {profiles.length > 1 && (
          <Select value={activeFilter} onValueChange={setAccountFilter}>
            <SelectTrigger className="w-44" aria-label={m('accountFilter')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{m('allAccounts')}</SelectItem>
              {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Segmented
          value={range}
          onValueChange={setRange}
          aria-label={m('rangeLabel')}
          options={[
            { value: 'today', label: m('rangeToday') },
            { value: '7d', label: m('range7d') },
            { value: '30d', label: m('range30d') },
            { value: 'all', label: m('rangeAll') },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[11px] text-fg-mute @2xl:inline">
            {m('updatedAt', { time: new Date(scannedAt).toLocaleTimeString() })}
          </span>
          <label className="flex items-center gap-1.5 text-xs text-fg-mute" title={m('autoRefreshHint', { seconds: POLL_MS / 1000 })}>
            <Switch checked={auto} onCheckedChange={setAuto} aria-label={m('autoRefresh')} />
            {m('autoRefresh')}
          </label>
          <IconButton title={m('refresh')} aria-label={m('refresh')} busy={busy} onClick={() => void refresh()}>
            <RefreshCw className="h-4 w-4" />
          </IconButton>
        </div>
      </ToolToolbar>
      <Tabs tabs={tabs} active={tab} onSelect={(id) => setTab(id as TabId)} className="bg-bg-2/10" />

      <div className="tool-scrollable tool-padding tool-spacer min-h-0 flex-1">
        {error && <Callout tone="error" title={m('scanFailed')}>{error}</Callout>}
        {snapshots === null && !error && <LoadingRow label={m('scanning')} />}
        {snapshots !== null && tab === 'accounts' && (
          <AccountsView
            profiles={profiles}
            detection={detection}
            snapshots={snapshots}
            allRows={allRows}
            fromHour={fromHour}
            m={m}
          />
        )}
        {snapshots !== null && tab !== 'accounts' && allRows.length === 0 && (
          <EmptyState
            icon={Bot}
            title={m('noDataTitle')}
            description={m('noDataBody')}
            action={{ label: m('manageAccounts'), onClick: () => setTab('accounts') }}
          />
        )}
        {snapshots !== null && allRows.length > 0 && tab === 'overview' && <OverviewView {...view} />}
        {snapshots !== null && allRows.length > 0 && tab === 'sessions' && <SessionsView {...view} />}
        {snapshots !== null && allRows.length > 0 && tab === 'usage' && <UsageView {...view} />}
      </div>
    </div>
  );
}
