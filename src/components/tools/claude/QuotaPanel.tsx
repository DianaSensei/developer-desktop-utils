import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, Settings2 } from 'lucide-react';
import {
  Badge, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton, StatusDot, cn,
} from '@/design-system';
import { useMessages } from '@/contexts/LocaleContext';
import { usePluginSdkFor, usePluginState, useToolActiveRef } from '@/platform';
import MESSAGES from './ClaudeManager.messages';
import {
  currentUse, formatDuration, latestQuota, quotaLevel, quotaModel,
  type Profile, type ProfileSnapshot, type QuotaReading, type QuotaWindow,
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

const STROKE = { ok: 'text-ok', warn: 'text-warn', over: 'text-bad' } as const;
const DOT = { ok: 'bg-ok', warn: 'bg-warn', over: 'bg-bad' } as const;

/**
 * The two plan limits as nested rings: 5-hour outside, weekly inside. Each
 * arc is coloured by how close it is to the limit, so the account to avoid
 * stands out without reading a number.
 */
function QuotaRings({ five, week, now, label }: { five?: QuotaWindow; week?: QuotaWindow; now: number; label: string }) {
  const rings = [
    { window: five, r: 34 },
    { window: week, r: 23 },
  ];
  return (
    <svg viewBox="0 0 84 84" className="h-[84px] w-[84px] shrink-0 -rotate-90" role="img" aria-label={label}>
      {rings.map(({ window, r }) => {
        const used = window ? Math.min(100, currentUse(window, now)) : 0;
        const length = 2 * Math.PI * r;
        return (
          <g key={r} fill="none" strokeWidth={8}>
            <circle cx={42} cy={42} r={r} className="stroke-current text-bg-2" />
            {window && used > 0 && (
              <circle
                cx={42}
                cy={42}
                r={r}
                strokeLinecap="round"
                strokeDasharray={`${(used / 100) * length} ${length}`}
                className={cn('stroke-current transition-[stroke-dasharray]', STROKE[quotaLevel(used)])}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Legend line for one ring: name, share used, time to reset. */
function QuotaLegend({ window, name, ring, now, m }: { window?: QuotaWindow; name: string; ring: string; now: number; m: M }) {
  const used = window ? currentUse(window, now) : null;
  const reset = !window || window.resetsAt === null
    ? null
    : window.resetsAt <= now ? m('quotaReset') : m('quotaResetsIn', { time: formatDuration(window.resetsAt - now) });
  return (
    <div className="min-w-0" title={ring}>
      <div className="flex items-center gap-1.5 text-xs text-fg-mute">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', used === null ? 'bg-bg-2' : DOT[quotaLevel(used)])} />
        {name}
      </div>
      <div className="flex items-baseline gap-1.5 pl-3.5">
        <span className="text-lg font-semibold tabular-nums">{used === null ? '—' : `${Math.round(used)}%`}</span>
        {reset && <span className="truncate font-mono text-[11px] text-fg-mute">{reset}</span>}
      </div>
    </div>
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
      <div className="space-y-0.5" title={[hint, error].filter(Boolean).join('\n')}>
        <div className="flex items-center gap-1.5 text-fg-mute">
          <StatusDot tone={error ? 'error' : 'idle'} size="xs" />
          {text}
        </div>
        {error && <div className="truncate text-warn">{error}</div>}
      </div>
    );
  }
  const source = m(reading.source === 'api' ? 'quotaFromApi' : 'quotaFromStatusline');
  const staleHint = stale ? m(reading.source === 'api' ? 'quotaStaleApi' : 'quotaStaleStatusline') : null;
  const tooltip = [staleHint, reading.credential, error].filter(Boolean).join('\n') || undefined;
  return (
    <div className="space-y-0.5" title={tooltip}>
      <div className={cn('flex items-center gap-1.5 whitespace-nowrap', stale ? 'text-warn' : 'text-fg-mute')}>
        <StatusDot tone={error ? 'error' : stale ? 'paused' : 'live'} size="xs" />
        <span>{source} · {age(m, reading.observedAt, now)}</span>
        {stale && <Badge tone="warning" size="xs">{m('quotaStaleBadge')}</Badge>}
      </div>
      {error && <div className="truncate text-warn">{error}</div>}
    </div>
  );
}

interface QuotaPanelProps {
  profiles: Profile[];
  snapshots: ProfileSnapshot[] | null;
  api: ReturnType<typeof useApiQuota>;
  now: number;
  onSetApi: (profile: Profile, on: boolean) => void;
  onHookChanged: () => void;
}

type Pending = { kind: 'hook' | 'api'; profile: Profile } | null;

/** One card per account: the 5-hour and weekly limits as nested rings, with reset times. */
export function QuotaPanel({ profiles, snapshots, api, now, onSetApi, onHookChanged }: QuotaPanelProps) {
  const m = useMessages(MESSAGES);
  const sdk = usePluginSdkFor('claude-manager');
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

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 text-sm font-medium" title={m('quotaNote')}>{m('quotaTitle')}</h3>
        {anyApi && (
          <IconButton title={m('quotaRefreshAll')} aria-label={m('quotaRefreshAll')} onClick={api.refreshAll}>
            <RefreshCw className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {profiles.map((profile, i) => {
          const snap = snapshots?.[i];
          const apiState = api.states[profile.id];
          const reading = latestQuota(snap?.statuslineQuota, profile.quotaApi ? apiState?.reading : null);
          const error = hookError[profile.id] || (profile.quotaApi ? apiState?.error : undefined);
          const stale = reading !== null && now - reading.observedAt > STALE_MS;
          const others = reading?.windows.filter((w) => w.key !== 'five_hour' && w.key !== 'seven_day') ?? [];
          const five = windowOf(reading, 'five_hour');
          const week = windowOf(reading, 'seven_day');
          return (
            <div key={profile.id} className="flex flex-col rounded-md border border-line bg-bg-1 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" title={profile.label}>{profile.label}</div>
                  <div className="truncate text-[11px] text-fg-mute">{snap?.account?.email ?? m('notSignedIn')}</div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-fg-mute transition-colors hover:bg-bg-2 hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus disabled:opacity-40"
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
              </div>

              <div className="my-2 flex items-center gap-3">
                <QuotaRings
                  five={five}
                  week={week}
                  now={now}
                  label={m('quotaRingsLabel', {
                    label: profile.label,
                    five: five ? Math.round(currentUse(five, now)) : '—',
                    week: week ? Math.round(currentUse(week, now)) : '—',
                  })}
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <QuotaLegend window={five} name={m('quota5h')} ring={m('quotaRingOuter')} now={now} m={m} />
                  <QuotaLegend window={week} name={m('quotaWeekly')} ring={m('quotaRingInner')} now={now} m={m} />
                </div>
              </div>

              {others.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {others.map((w) => (
                    <Badge key={w.key} mono title={windowLabel(m, w.key)}>
                      {windowLabel(m, w.key)} {Math.round(currentUse(w, now))}%
                    </Badge>
                  ))}
                </div>
              )}

              <div className="mt-auto border-t border-line pt-2 text-xs">
                <SourceCell
                  reading={reading}
                  stale={stale}
                  hookOn={Boolean(snap?.quotaHook)}
                  apiOn={Boolean(profile.quotaApi)}
                  error={error ? errorText(m, error) : null}
                  now={now}
                  m={m}
                />
              </div>
            </div>
          );
        })}
      </div>

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
