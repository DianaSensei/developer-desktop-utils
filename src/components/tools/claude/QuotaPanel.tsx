import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge, Callout, ConfirmDialog, IconButton, Switch, cn } from '@/design-system';
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
    const tick = () => {
      if (!inFrontRef.current || document.visibilityState !== 'visible') return;
      for (const profile of profiles) {
        if (!profile.quotaApi) continue;
        const state = statesRef.current[profile.id];
        const wait = state?.error === 'rate-limited' ? API_BACKOFF_MS : API_REFRESH_MS;
        if (!state || Date.now() - state.fetchedAt >= wait) void refresh(profile);
      }
    };
    tick();
    const timer = setInterval(tick, API_TICK_MS);
    return () => clearInterval(timer);
  }, [active, profiles, refresh, inFrontRef, sdk]);

  return { states, refresh, busy: (id: string) => pending.current.has(id) };
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

function QuotaBar({ window, now, m }: { window: QuotaWindow; now: number; m: M }) {
  const used = currentUse(window, now);
  const level = quotaLevel(used);
  const reset = window.resetsAt === null
    ? null
    : window.resetsAt <= now ? m('quotaReset') : m('quotaResetsIn', { time: formatDuration(window.resetsAt - now) });
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate">
          <span className="font-semibold">{windowLabel(m, window.key)}</span>
          {reset && <span className="font-mono text-fg-mute"> · {reset}</span>}
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

  return (
    <section className="space-y-2">
      <div className="grid gap-3 @2xl:grid-cols-2 @6xl:grid-cols-3">
        {profiles.map((profile, i) => {
          const snap = snapshots?.[i];
          const apiState = api.states[profile.id];
          const reading = latestQuota(snap?.statuslineQuota, profile.quotaApi ? apiState?.reading : null);
          const error = hookError[profile.id] || (profile.quotaApi ? apiState?.error : undefined);
          return (
            <div
              key={profile.id}
              className={cn('flex flex-col gap-3 rounded-lg border bg-card p-4', profile.id === suggested ? 'border-ok-edge' : 'border-line')}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium" title={profile.label}>{profile.label}</div>
                  <div className="truncate text-[11px] text-fg-mute">{snap?.account?.email ?? m('notSignedIn')}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {profile.id === suggested && <Badge tone="success" size="xs">{m('quotaMostRoom')}</Badge>}
                  {reading && (
                    <span className="text-[11px] text-fg-mute">
                      {m(reading.source === 'api' ? 'quotaFromApi' : 'quotaFromStatusline')} · {age(m, reading.observedAt, now)}
                    </span>
                  )}
                </div>
              </div>

              {reading
                ? reading.windows.map((w) => <QuotaBar key={w.key} window={w} now={now} m={m} />)
                : <p className="text-xs text-fg-mute">{m(snap?.quotaHook ? 'quotaWaiting' : 'quotaNone')}</p>}

              {error && <Callout tone="warning" size="sm">{errorText(m, error)}</Callout>}

              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-fg-mute">
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
                    className="ml-auto"
                    title={m('quotaRefresh')}
                    aria-label={m('quotaRefresh')}
                    busy={api.busy(profile.id)}
                    onClick={() => void api.refresh(profile)}
                  >
                    <RefreshCw className="h-3 w-3" />
                  </IconButton>
                )}
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
