import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge, ConfirmDialog, DataTable, IconButton, Switch, Tbody, Td, Th, Thead, Tr, cn } from '@/design-system';
import { useMessages } from '@/contexts/LocaleContext';
import { usePluginSdkFor, usePluginState, useToolActiveRef } from '@/platform';
import MESSAGES from './ClaudeManager.messages';
import {
  currentUse, formatDuration, latestQuota, quotaLevel, quotaModel, quotaPressure,
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
 * (the Compare tab is open and the tool is in front), at most every five
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

const BAR = { ok: 'bg-ok', warn: 'bg-warn', over: 'bg-bad' } as const;

function QuotaBar({ window, now, m, hideLabel = false }: { window: QuotaWindow; now: number; m: M; hideLabel?: boolean }) {
  const used = currentUse(window, now);
  const level = quotaLevel(used);
  const reset = window.resetsAt === null
    ? null
    : window.resetsAt <= now ? m('quotaReset') : m('quotaResetsIn', { time: formatDuration(window.resetsAt - now) });
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate">
          {!hideLabel && <span className="font-semibold">{windowLabel(m, window.key)} · </span>}
          {reset && <span className="font-mono text-fg-mute">{reset}</span>}
        </span>
        <span className="shrink-0 font-semibold tabular-nums">{Math.round(used)}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-2">
        <div className={cn('h-full rounded-full transition-[width]', BAR[level])} style={{ width: `${Math.min(100, used)}%` }} />
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

interface QuotaPanelProps {
  profiles: Profile[];
  snapshots: ProfileSnapshot[] | null;
  api: ReturnType<typeof useApiQuota>;
  suggested: string | null;
  now: number;
  onSetApi: (profile: Profile, on: boolean) => void;
  onHookChanged: () => void;
}

type Pending = { kind: 'hook' | 'api'; profile: Profile } | null;

/** One card per account with the share of each plan limit used and when it resets. */
export function QuotaPanel({ profiles, snapshots, api, suggested, now, onSetApi, onHookChanged }: QuotaPanelProps) {
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

  const entries = profiles.map((profile, i) => {
    const snap = snapshots?.[i];
    const apiState = api.states[profile.id];
    const reading = latestQuota(snap?.statuslineQuota, profile.quotaApi ? apiState?.reading : null);
    return { profile, snap, apiState, reading, pressure: reading ? quotaPressure(reading, now) : null };
  });
  // Most room first; accounts without numbers last, in their own order.
  const sorted = [...entries].sort((a, b) => (a.pressure ?? 1e9) - (b.pressure ?? 1e9));
  const anyApi = profiles.some((p) => p.quotaApi);
  const windowOf = (reading: QuotaReading | null, key: string) => reading?.windows.find((w) => w.key === key);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 text-sm font-medium">{m('quotaTitle')}</h3>
        {anyApi && (
          <IconButton title={m('quotaRefreshAll')} aria-label={m('quotaRefreshAll')} onClick={api.refreshAll}>
            <RefreshCw className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      <DataTable>
        <Thead>
          <Tr>
            <Th>{m('colAccount')}</Th>
            <Th className="w-[26%]">{m('quota5h')}</Th>
            <Th className="w-[26%]">{m('quotaWeekly')}</Th>
            <Th>{m('quotaOther')}</Th>
            <Th>{m('quotaSourceCol')}</Th>
          </Tr>
        </Thead>
        <Tbody>
          {sorted.map(({ profile, snap, apiState, reading }) => {
            const error = hookError[profile.id] || (profile.quotaApi ? apiState?.error : undefined);
            const stale = reading !== null && now - reading.observedAt > STALE_MS;
            const others = reading?.windows.filter((w) => w.key !== 'five_hour' && w.key !== 'seven_day') ?? [];
            const five = windowOf(reading, 'five_hour');
            const week = windowOf(reading, 'seven_day');
            return (
              <Tr key={profile.id} selected={profile.id === suggested}>
                <Td className="max-w-[14rem] align-top">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium" title={profile.label}>{profile.label}</span>
                    {profile.id === suggested && <Badge tone="success" size="xs">{m('quotaMostRoom')}</Badge>}
                  </div>
                  <div className="truncate text-[11px] text-fg-mute">{snap?.account?.email ?? m('notSignedIn')}</div>
                </Td>
                <Td className="align-top">
                  {five ? <QuotaBar window={five} now={now} m={m} hideLabel /> : <span className="text-fg-mute">—</span>}
                </Td>
                <Td className="align-top">
                  {week ? <QuotaBar window={week} now={now} m={m} hideLabel /> : <span className="text-fg-mute">—</span>}
                </Td>
                <Td className="align-top">
                  {others.length === 0 ? <span className="text-fg-mute">—</span> : (
                    <div className="flex flex-wrap gap-1">
                      {others.map((w) => (
                        <Badge key={w.key} mono title={windowLabel(m, w.key)}>
                          {windowLabel(m, w.key)} {Math.round(currentUse(w, now))}%
                        </Badge>
                      ))}
                    </div>
                  )}
                </Td>
                <Td className="align-top text-xs">
                  {reading ? (
                    <div className={cn(stale ? 'text-warn' : 'text-fg-mute')} title={reading.credential ?? undefined}>
                      {m(reading.source === 'api' ? 'quotaFromApi' : 'quotaFromStatusline')} · {age(m, reading.observedAt, now)}
                      {stale && <div>{m(reading.source === 'api' ? 'quotaStaleApi' : 'quotaStaleStatusline')}</div>}
                      {reading.credential && <div className="truncate font-mono text-[11px] text-fg-mute">{reading.credential}</div>}
                    </div>
                  ) : (
                    <div className="text-fg-mute">{m(snap?.quotaHook ? 'quotaWaiting' : 'quotaNone')}</div>
                  )}
                  {error && <div className="mt-1 text-warn">{errorText(m, error)}</div>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-fg-mute">
                    <label className="flex items-center gap-1.5" title={m('quotaHookHint')}>
                      <Switch
                        checked={Boolean(snap?.quotaHook)}
                        disabled={!snap?.exists}
                        onCheckedChange={(on) => (on ? setConfirm({ kind: 'hook', profile }) : void setHook(profile, false))}
                        aria-label={m('quotaHookLabel', { label: profile.label })}
                      />
                      {m('quotaHook')}
                    </label>
                    <label className="flex items-center gap-1.5" title={m('quotaApiHint')}>
                      <Switch
                        checked={Boolean(profile.quotaApi)}
                        disabled={!snap?.exists}
                        onCheckedChange={(on) => (on ? setConfirm({ kind: 'api', profile }) : onSetApi(profile, false))}
                        aria-label={m('quotaApiLabel', { label: profile.label })}
                      />
                      {m('quotaApi')}
                    </label>
                    {profile.quotaApi && (
                      <IconButton
                        size="xs"
                        title={m('quotaRefresh')}
                        aria-label={m('quotaRefresh')}
                        busy={api.busy(profile.id)}
                        onClick={() => void api.refresh(profile)}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </IconButton>
                    )}
                  </div>
                </Td>
              </Tr>
            );
          })}
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
