import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, RefreshCw, Settings2 } from 'lucide-react';
import {
  Badge, ConfirmDialog, DataTable, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton,
  SectionLabel, Segmented, StatusDot, Tbody, Td, Th, Thead, Tr, cn,
} from '@/design-system';
import { useMessages } from '@/contexts/LocaleContext';
import { usePluginSdkFor, usePluginState, useToolActiveRef } from '@/platform';
import MESSAGES from './ClaudeManager.messages';
import {
  SHARED_ACCOUNT, currentUse, formatCost, formatDuration, formatTokens, latestQuota, quotaLevel, quotaModel,
  type Profile, type ProfileSnapshot, type QuotaReading, type QuotaWindow, type UsageTotals,
} from './usage';

type M = ReturnType<typeof useMessages<typeof MESSAGES>>;

/** Last answer from the usage API for one account. No secrets: numbers and an error code. */
export interface ApiQuotaState {
  reading?: QuotaReading;
  error?: string;
  fetchedAt: number;
}

const API_REFRESH_MS = 5 * 60_000;
/** The endpoint refuses callers that ask often; back off well beyond its window. */
const API_BACKOFF_MS = 15 * 60_000;
const API_TICK_MS = 60_000;
/** Opening the tab refreshes anything older than this. */
const API_ON_OPEN_MS = 60_000;
/** A reading older than this is shown as possibly out of date. */
export const STALE_MS = 15 * 60_000;

/**
 * Asks the usage API for every account that opted in, while `active`
 * (the Usage tab is open and the tool is in front), at most every five
 * minutes per account. Answers are kept in plugin storage.
 */
export function useApiQuota(profiles: Profile[], active: boolean) {
  const sdk = usePluginSdkFor('claude-manager');
  const inFrontRef = useToolActiveRef();
  const [states, setStates] = usePluginState<Record<string, ApiQuotaState>>(sdk, 'apiQuota', {});
  const statesRef = useRef(states);
  statesRef.current = states;
  const pending = useRef(new Set<string>());

  const refreshAll = useCallback(() => {
    for (const profile of profiles) if (profile.quotaApi) void refresh(profile);
  }, [profiles]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async (profile: Profile) => {
    if (pending.current.has(profile.id)) return;
    pending.current.add(profile.id);
    try {
      const reading = await sdk.native.invoke<QuotaReading>('claude_monitor_fetch_quota', { dir: profile.configDir });
      setStates((s) => ({ ...s, [profile.id]: { reading, fetchedAt: Date.now() } }));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      // Keep the last good numbers next to the error.
      setStates((s) => ({ ...s, [profile.id]: { reading: s[profile.id]?.reading, error, fetchedAt: Date.now() } }));
    } finally {
      pending.current.delete(profile.id);
    }
  }, [sdk, setStates]);

  useEffect(() => {
    if (!active || !sdk.env.isTauri) return;
    const tick = (opening = false) => {
      if (!inFrontRef.current || document.visibilityState !== 'visible') return;
      for (const profile of profiles) {
        if (!profile.quotaApi) continue;
        const state = statesRef.current[profile.id];
        const wait = state?.error === 'rate-limited' ? API_BACKOFF_MS : opening ? API_ON_OPEN_MS : API_REFRESH_MS;
        if (!state || Date.now() - state.fetchedAt >= wait) void refresh(profile);
      }
    };
    tick(true);
    const timer = setInterval(() => tick(), API_TICK_MS);
    return () => clearInterval(timer);
  }, [active, profiles, refresh, inFrontRef, sdk]);

  return { states, refresh, refreshAll, busy: (id: string) => pending.current.has(id) };
}

const ERROR_KEY: Record<string, keyof typeof MESSAGES> = {
  'no-credentials': 'quotaErrNoCredentials',
  'token-expired': 'quotaErrExpired',
  unauthorized: 'quotaErrUnauthorized',
  'rate-limited': 'quotaErrRateLimited',
  'bad-response': 'quotaErrBadResponse',
  'settings-invalid': 'quotaErrSettings',
  'not-config-dir': 'saveNotConfigDir',
};

function errorText(m: M, code: string): string {
  const key = ERROR_KEY[code];
  if (key) return m(key);
  return code.startsWith('http-') ? m('quotaErrHttp', { status: code.slice(5) }) : code;
}

function windowLabel(m: M, key: string): string {
  if (key === 'five_hour') return m('quota5h');
  if (key === 'seven_day') return m('quotaWeekly');
  if (key === 'spend_limit') return m('quotaSpend');
  return quotaModel(key) ?? key;
}

export type QuotaShow = 'used' | 'left';

const BARS = 4;
const LEVEL_TEXT = { ok: 'text-ok', warn: 'text-warn', over: 'text-bad' } as const;

/** How many of the four bars are lit: a quarter of the limit each, used or left. */
export function litBars(used: number, show: QuotaShow): number {
  const value = Math.max(0, Math.min(100, show === 'used' ? used : 100 - used));
  return Math.max(0, Math.min(BARS, Math.ceil(value / (100 / BARS) - 1e-9)));
}

/** Diagonal stripes in the colour of the group it sits in. */
function Hatch({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width={2.4} height={2.4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={1.2} height={2.4} fill="currentColor" />
      </pattern>
    </defs>
  );
}

/** One row of four rising bars; the weekly row is striped, the 5-hour row solid. */
function SignalRow({ window, show, now, baseline, striped, id }: {
  window?: QuotaWindow; show: QuotaShow; now: number; baseline: number; striped: boolean; id: string;
}) {
  const used = window ? currentUse(window, now) : null;
  const lit = used === null ? 0 : litBars(used, show);
  const tone = used === null ? 'text-fg-mute' : LEVEL_TEXT[quotaLevel(used)];
  const bar = (i: number, on: boolean) => {
    const h = 4 + i * 2;
    const box = { x: i * 6, y: baseline - h, width: 4, height: h, rx: 0.8 };
    if (!striped) return <rect key={i} {...box} fill="currentColor" />;
    return (
      <rect key={i} {...box} x={box.x + 0.5} y={box.y + 0.5} width={3} height={h - 1}
        fill={`url(#${id}-${on ? 'on' : 'off'})`} stroke="currentColor" strokeWidth={1} />
    );
  };
  return (
    <>
      <g className={tone}>
        {striped && <Hatch id={`${id}-on`} />}
        {Array.from({ length: BARS }, (_, i) => i).filter((i) => i < lit).map((i) => bar(i, true))}
      </g>
      <g className="text-fg-mute opacity-30">
        {striped && <Hatch id={`${id}-off`} />}
        {Array.from({ length: BARS }, (_, i) => i).filter((i) => i >= lit).map((i) => bar(i, false))}
      </g>
    </>
  );
}

/**
 * Both plan limits in one small icon, like a dual-SIM signal indicator:
 * 5-hour on top with solid bars, weekly below with striped bars. Bars count
 * what is used (or what is left), each a quarter; colour follows how close
 * the limit is.
 */
function SignalIcon({ five, week, show, now, label }: {
  five?: QuotaWindow; week?: QuotaWindow; show: QuotaShow; now: number; label: string;
}) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 22 23" style={{ width: 20, height: 21 }} className="shrink-0" role="img" aria-label={label}>
      <SignalRow window={five} show={show} now={now} baseline={10} striped={false} id={`${id}5`} />
      <SignalRow window={week} show={show} now={now} baseline={23} striped id={`${id}w`} />
    </svg>
  );
}

/** Small key for a row of the icon: a solid or striped square. */
function Swatch({ striped, tone }: { striped: boolean; tone: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 8 8" style={{ width: 8, height: 8 }} className={cn('shrink-0', tone)} aria-hidden>
      {striped ? (
        <>
          <Hatch id={id} />
          <rect x={0.5} y={0.5} width={7} height={7} rx={1} fill={`url(#${id})`} stroke="currentColor" strokeWidth={1} />
        </>
      ) : <rect width={8} height={8} rx={1} fill="currentColor" />}
    </svg>
  );
}

function limitText(m: M, window: QuotaWindow | undefined, show: QuotaShow, now: number) {
  if (!window) return null;
  const used = currentUse(window, now);
  const value = show === 'used' ? `${Math.round(used)}%` : m('quotaLeftValue', { n: Math.round(100 - used) });
  const reset = window.resetsAt === null
    ? null
    : window.resetsAt <= now
      ? { short: m('quotaReset'), long: m('quotaReset') }
      : { short: `↻ ${formatDuration(window.resetsAt - now)}`, long: m('quotaResetsIn', { time: formatDuration(window.resetsAt - now) }) };
  return { value, reset, tone: LEVEL_TEXT[quotaLevel(used)] };
}

/** One limit on one line: share (used or left) and time to reset. */
function LimitCell({ window, show, now, m }: { window?: QuotaWindow; show: QuotaShow; now: number; m: M }) {
  const t = limitText(m, window, show, now);
  if (!t) return <span className="text-fg-mute">—</span>;
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className={cn('font-semibold tabular-nums', show === 'left' ? '' : t.tone)}>{t.value}</span>
      {t.reset && <span className="font-mono text-[11px] text-fg-mute" title={t.reset.long}>{t.reset.short}</span>}
    </span>
  );
}

function age(m: M, at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return m('justNow');
  if (minutes < 60) return m('minutesAgo', { n: minutes });
  if (minutes < 1440) return m('hoursAgo', { n: Math.floor(minutes / 60) });
  return m('daysAgo', { n: Math.floor(minutes / 1440) });
}

/**
 * One short line: a dot (fresh / out of date / nothing), where the numbers
 * came from and how old they are. The long explanation, the sign-in used and
 * any error sit in the tooltip so the table stays easy to scan.
 */
function SourceCell({ reading, stale, hookOn, apiOn, error, now, m }: {
  reading: QuotaReading | null;
  stale: boolean;
  hookOn: boolean;
  apiOn: boolean;
  error: string | null;
  now: number;
  m: M;
}) {
  if (!reading) {
    const text = hookOn ? m('quotaWaitingShort') : apiOn ? m('quotaFetching') : m('quotaNoneShort');
    const hint = hookOn ? m('quotaWaiting') : m('quotaNone');
    return (
      <div className="flex items-center gap-1.5 whitespace-nowrap text-fg-mute" title={[error, hint].filter(Boolean).join('\n')}>
        <StatusDot tone={error ? 'error' : 'idle'} size="xs" />
        {text}
        {error && <Badge tone="danger" size="xs">{m('quotaErrorBadge')}</Badge>}
      </div>
    );
  }
  const source = m(reading.source === 'api' ? 'quotaFromApi' : 'quotaFromStatusline');
  const staleHint = stale ? m(reading.source === 'api' ? 'quotaStaleApi' : 'quotaStaleStatusline') : null;
  const tooltip = [error, staleHint, reading.credential].filter(Boolean).join('\n') || undefined;
  return (
    <div className={cn('flex items-center gap-1.5 whitespace-nowrap', stale ? 'text-warn' : 'text-fg-mute')} title={tooltip}>
      <StatusDot tone={error ? 'error' : stale ? 'paused' : 'live'} size="xs" />
      <span>{source} · {age(m, reading.observedAt, now)}</span>
      {stale && <Badge tone="warning" size="xs">{m('quotaStaleBadge')}</Badge>}
      {error && <Badge tone="danger" size="xs">{m('quotaErrorBadge')}</Badge>}
    </div>
  );
}

interface QuotaPanelProps {
  profiles: Profile[];
  snapshots: ProfileSnapshot[] | null;
  api: ReturnType<typeof useApiQuota>;
  now: number;
  /** Local usage in the chosen range, per account id (SHARED_ACCOUNT included). */
  usage: Map<string, UsageTotals>;
  onSetApi: (profile: Profile, on: boolean) => void;
  onHookChanged: () => void;
}

type Pending = { kind: 'hook' | 'api'; profile: Profile } | null;

function costText(t: UsageTotals | undefined): string {
  if (!t) return '—';
  return t.cost === 0 && t.unpriced > 0 ? '—' : formatCost(t.cost);
}

/**
 * Every account in one table: its plan limits as a dual-signal icon, the
 * tokens and cost it used in the chosen range, and where the limit numbers
 * come from (with a ⚙ menu to turn each source on or off).
 */
export function QuotaPanel({ profiles, snapshots, api, now, usage, onSetApi, onHookChanged }: QuotaPanelProps) {
  const m = useMessages(MESSAGES);
  const sdk = usePluginSdkFor('claude-manager');
  const [show, setShow] = usePluginState<QuotaShow>(sdk, 'quotaShow', 'used');
  const [confirm, setConfirm] = useState<Pending>(null);
  const [hookError, setHookError] = useState<Record<string, string>>({});

  const setHook = async (profile: Profile, enable: boolean) => {
    try {
      await sdk.native.invoke('claude_monitor_quota_hook', { dir: profile.configDir, enable });
      setHookError((e) => ({ ...e, [profile.id]: '' }));
      onHookChanged();
    } catch (e) {
      setHookError((errs) => ({ ...errs, [profile.id]: e instanceof Error ? e.message : String(e) }));
    }
  };

  const anyApi = profiles.some((p) => p.quotaApi);
  const windowOf = (reading: QuotaReading | null, key: string) => reading?.windows.find((w) => w.key === key);
  const shared = usage.get(SHARED_ACCOUNT);

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel className="flex-1" title={m('quotaNote')}>{m('byAccount')}</SectionLabel>
        <Segmented
          size="sm"
          value={show}
          onValueChange={setShow}
          aria-label={m('quotaShowLabel')}
          options={[
            { value: 'used', label: m('quotaShowUsed') },
            { value: 'left', label: m('quotaShowLeft') },
          ]}
        />
        {anyApi && (
          <IconButton title={m('quotaRefreshAll')} aria-label={m('quotaRefreshAll')} onClick={api.refreshAll}>
            <RefreshCw className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      <DataTable density="compact">
        <Thead>
          <Tr>
            <Th>{m('colAccount')}</Th>
            <Th className="w-8" aria-label={m('quotaCol')} />
            <Th><span className="inline-flex items-center gap-1.5"><Swatch striped={false} tone="text-fg-mute" />{m('quota5h')}</span></Th>
            <Th><span className="inline-flex items-center gap-1.5"><Swatch striped tone="text-fg-mute" />{m('quotaWeekly')}</span></Th>
            <Th>{m('quotaOther')}</Th>
            <Th align="right">{m('colTokens')}</Th>
            <Th align="right">{m('colCost')}</Th>
            <Th>{m('quotaSourceCol')}</Th>
            <Th className="w-8" />
          </Tr>
        </Thead>
        <Tbody>
          {profiles.map((profile, i) => {
            const snap = snapshots?.[i];
            const apiState = api.states[profile.id];
            const reading = latestQuota(snap?.statuslineQuota, profile.quotaApi ? apiState?.reading : null);
            const error = hookError[profile.id] || (profile.quotaApi ? apiState?.error : undefined);
            const stale = reading !== null && now - reading.observedAt > STALE_MS;
            const others = reading?.windows.filter((w) => w.key !== 'five_hour' && w.key !== 'seven_day') ?? [];
            const totals = usage.get(profile.id);
            const five = windowOf(reading, 'five_hour');
            const week = windowOf(reading, 'seven_day');
            return (
              <Tr key={profile.id}>
                <Td className="max-w-[12rem]">
                  <div className="truncate font-medium" title={[profile.label, snap?.account?.email ?? m('notSignedIn')].join('\n')}>
                    {profile.label}
                  </div>
                </Td>
                <Td>
                  {five || week ? (
                    <SignalIcon
                      five={five}
                      week={week}
                      show={show}
                      now={now}
                      label={m('quotaSignalLabel', {
                        label: profile.label,
                        five: limitText(m, five, show, now)?.value ?? '—',
                        week: limitText(m, week, show, now)?.value ?? '—',
                      })}
                    />
                  ) : <span className="text-fg-mute">—</span>}
                </Td>
                <Td><LimitCell window={five} show={show} now={now} m={m} /></Td>
                <Td><LimitCell window={week} show={show} now={now} m={m} /></Td>
                <Td>
                  {others.length === 0 ? <span className="text-fg-mute">—</span> : (
                    <span className="flex gap-1 whitespace-nowrap">
                      {others.map((w) => (
                        <Badge key={w.key} mono size="xs" title={windowLabel(m, w.key)}>
                          {windowLabel(m, w.key)} {limitText(m, w, show, now)?.value}
                        </Badge>
                      ))}
                    </span>
                  )}
                </Td>
                <Td numeric>{totals ? formatTokens(totals.tokens) : '—'}</Td>
                <Td numeric>{costText(totals)}</Td>
                <Td className="text-xs">
                  <SourceCell
                    reading={reading}
                    stale={stale}
                    hookOn={Boolean(snap?.quotaHook)}
                    apiOn={Boolean(profile.quotaApi)}
                    error={error ? errorText(m, error) : null}
                    now={now}
                    m={m}
                  />
                </Td>
                <Td align="right">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="grid h-6 w-6 place-items-center rounded-sm text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus disabled:opacity-40"
                      title={m('quotaSourcesMenu', { label: profile.label })}
                      aria-label={m('quotaSourcesMenu', { label: profile.label })}
                      disabled={!snap?.exists}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuItem
                        active={Boolean(snap?.quotaHook)}
                        icon={snap?.quotaHook ? <Check className="h-3.5 w-3.5" /> : <span className="inline-block h-3.5 w-3.5" />}
                        title={m('quotaHookHint')}
                        onClick={() => (snap?.quotaHook ? void setHook(profile, false) : setConfirm({ kind: 'hook', profile }))}
                      >
                        {m(snap?.quotaHook ? 'quotaHookOff' : 'quotaHookOn')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        active={Boolean(profile.quotaApi)}
                        icon={profile.quotaApi ? <Check className="h-3.5 w-3.5" /> : <span className="inline-block h-3.5 w-3.5" />}
                        title={m('quotaApiHint')}
                        onClick={() => (profile.quotaApi ? onSetApi(profile, false) : setConfirm({ kind: 'api', profile }))}
                      >
                        {m(profile.quotaApi ? 'quotaApiOff' : 'quotaApiOn')}
                      </DropdownMenuItem>
                      {profile.quotaApi && (
                        <DropdownMenuItem icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void api.refresh(profile)}>
                          {m('quotaRefresh')}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Td>
              </Tr>
            );
          })}
          {shared && (
            <Tr>
              <Td className="whitespace-nowrap font-medium text-fg-mute">{m('sharedAccount')}</Td>
              <Td>{''}</Td>
              <Td>{''}</Td>
              <Td>{''}</Td>
              <Td>{''}</Td>
              <Td numeric>{formatTokens(shared.tokens)}</Td>
              <Td numeric>{costText(shared)}</Td>
              <Td>{''}</Td>
              <Td>{''}</Td>
            </Tr>
          )}
        </Tbody>
      </DataTable>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        destructive={false}
        title={m(confirm?.kind === 'api' ? 'quotaApiConfirmTitle' : 'quotaHookConfirmTitle', { label: confirm?.profile.label ?? '' })}
        description={m(confirm?.kind === 'api' ? 'quotaApiConfirmBody' : 'quotaHookConfirmBody')}
        confirmLabel={m('quotaEnable')}
        onConfirm={async () => {
          const pending = confirm;
          setConfirm(null);
          if (!pending) return;
          if (pending.kind === 'hook') await setHook(pending.profile, true);
          else {
            onSetApi(pending.profile, true);
            void api.refresh({ ...pending.profile, quotaApi: true });
          }
        }}
      />
    </section>
  );
}
