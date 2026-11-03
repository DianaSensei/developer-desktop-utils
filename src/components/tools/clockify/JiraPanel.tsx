// Jira pieces of the Tasks tab: the toolbar control (Connect / Sync), the
// connect dialog, the issue-key chip on a task, and the editor section
// (status in Jira, push errors, log time). State lives in jiraContext.tsx.

import { useMemo, useState } from 'react';
import { AlertTriangle, Clock, ExternalLink, Link2, RefreshCw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { usePluginSdkFor } from '@/platform';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from './jira.messages';
import { useClockify, type Task } from './store';
import { Modal, Toggle } from './ui';
import { fmtTotal } from './time';
import { API_TOKEN_URL, DEFAULT_JQL, JiraError, normalizeSite, pendingAcrossTasks, pendingWorklogs, worklogSeconds } from './jira';
import { useJira } from './jiraContext';

type Translate = ReturnType<typeof useMessages<typeof MESSAGES>>;

export function jiraErrorText(e: unknown, m: Translate): string {
  if (!(e instanceof JiraError)) return m('err.network', { message: e instanceof Error ? e.message : String(e) });
  if (e.message.startsWith('no-transition:')) return m('err.badRequest', { message: m('noTransition') });
  return m(`err.${e.kind}` as 'err.auth', { message: e.message });
}

function agoText(ts: number, now: number, m: Translate): string {
  const mins = Math.floor((now - ts) / 60_000);
  if (mins < 1) return m('justNow');
  if (mins < 60) return m('minutesAgo', { n: mins });
  return m('hoursAgo', { n: Math.floor(mins / 60) });
}

/** Toolbar control: "Connect Jira", or Sync + last-sync time + settings. */
export function JiraToolbar() {
  const m = useMessages(MESSAGES);
  const jira = useJira();
  const { now } = useClockify();
  const [dialog, setDialog] = useState(false);

  if (!jira.connected) {
    return (
      <>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setDialog(true)}>
          <Link2 className="h-3.5 w-3.5" />
          {m('connect')}
        </Button>
        {dialog && <JiraConnectDialog onClose={() => setDialog(false)} />}
      </>
    );
  }
  const last = jira.config?.lastSync;
  return (
    <div className="flex items-center gap-1">
      <LogAllButton />
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs"
        onClick={() => { void jira.sync(); }}
        disabled={jira.syncing}
        title={m('syncTitle')}
      >
        {jira.syncing ? <Spinner size="xs" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {jira.syncing ? m('syncing') : m('sync')}
      </Button>
      {last && !jira.syncing && (
        <span className="hidden text-[11px] text-fg-mute lg:inline" title={jira.lastResult ? m('syncResult', { added: jira.lastResult.added, updated: jira.lastResult.updated }) : undefined}>
          {m('syncedAgo', { ago: agoText(last, now, m) })}
        </span>
      )}
      <Button variant="ghost" size="icon" className="text-fg-mute" title={m('settings')} aria-label={m('settings')} onClick={() => setDialog(true)}>
        <Settings2 className="h-4 w-4" />
      </Button>
      {dialog && <JiraConnectDialog onClose={() => setDialog(false)} />}
    </div>
  );
}

/** "Log 2h 10m": every linked task's unlogged time in one go (end of day). */
function LogAllButton() {
  const m = useMessages(MESSAGES);
  const jira = useJira();
  const { tasks, entries } = useClockify();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const site = jira.config?.site ?? '';
  const pending = useMemo(() => pendingAcrossTasks(entries, tasks, site), [entries, tasks, site]);
  if (pending.tasks === 0 && !done) return null;
  if (pending.tasks === 0) return <span role="status" className="text-[11px] text-ok">{done}</span>;
  const total = fmtTotal(pending.seconds * 1000);
  return (
    <Button
      variant="tint"
      size="sm"
      className="gap-1.5 text-xs"
      busy={busy}
      title={m('logAllTitle', { n: pending.tasks })}
      onClick={() => {
        setBusy(true);
        jira.logAll()
          .then((r) => setDone(m('loggedAll', { t: fmtTotal(r.seconds * 1000), n: r.count })))
          .catch(() => { /* the error banner explains it */ })
          .finally(() => setBusy(false));
      }}
    >
      <Clock className="h-3.5 w-3.5" />
      {m('logAll', { t: total })}
    </Button>
  );
}

/** Sync / auth problem under the toolbar, with the fix one click away. */
export function JiraErrorBanner() {
  const m = useMessages(MESSAGES);
  const jira = useJira();
  const [dialog, setDialog] = useState(false);
  if (!jira.error) return null;
  return (
    <div role="alert" className="flex items-center gap-2 border-b border-line bg-warn/10 px-3 py-1.5 text-xs text-warn">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{jiraErrorText(jira.error, m)}</span>
      {jira.error.kind === 'auth' ? (
        <Button variant="outline" size="sm" className="text-xs" onClick={() => setDialog(true)}>{m('reconnect')}</Button>
      ) : (
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => { void jira.sync(); }}>{m('retry')}</Button>
      )}
      {dialog && <JiraConnectDialog onClose={() => setDialog(false)} />}
    </div>
  );
}

export function JiraConnectDialog({ onClose }: { onClose: () => void }) {
  const m = useMessages(MESSAGES);
  const sdk = usePluginSdkFor('task-tracker');
  const jira = useJira();
  const cfg = jira.config;
  const [site, setSite] = useState(cfg?.site.replace(/^https:\/\//, '') ?? '');
  const [email, setEmail] = useState(cfg?.email ?? '');
  const [token, setToken] = useState('');
  const [jql, setJql] = useState(cfg?.jql ?? DEFAULT_JQL);
  const [pushStatus, setPushStatus] = useState(cfg?.pushStatus ?? true);
  const [autoLog, setAutoLog] = useState(!!cfg?.autoLogSince);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const siteOk = !site.trim() || normalizeSite(site) != null;
  const keepToken = jira.connected && !token.trim() && normalizeSite(site) === cfg?.site && email.trim() === cfg?.email;
  const canSave = !!normalizeSite(site) && !!email.trim() && (!!token.trim() || keepToken) && !busy;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!keepToken) await jira.connect({ site, email, token, jql, pushStatus });
      // Keep the original "since" while it stays on, so turning the dialog
      // over doesn't skip entries that finished in between.
      const autoLogSince = autoLog ? cfg?.autoLogSince ?? Date.now() : null;
      jira.updateConfig({ jql: jql.trim() || DEFAULT_JQL, pushStatus, autoLogSince });
      onClose();
      void jira.sync();
    } catch (e) {
      setError(jiraErrorText(e, m));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={m('connectTitle')} width="max-w-lg">
      <form className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); if (canSave) void save(); }}>
        <p className="text-xs text-fg-mute">{m('connectIntro')}</p>
        {!sdk.env.isTauri && <p className="text-[11px] text-warn">{m('webWarning')}</p>}
        {jira.connected && cfg?.accountName && (
          <p className="text-xs text-ok">{m('connectedAs', { name: cfg.accountName, site: cfg.site.replace(/^https:\/\//, '') })}</p>
        )}
        <label className="block space-y-1.5">
          <span className="block text-xs font-medium text-fg-mute">{m('site')}</span>
          <Input value={site} onChange={(e) => setSite(e.target.value)} placeholder={m('sitePlaceholder')} className="h-ctl" autoFocus={!cfg} aria-invalid={!siteOk} />
          {!siteOk && <span className="block text-[11px] text-bad">{m('siteInvalid')}</span>}
        </label>
        <label className="block space-y-1.5">
          <span className="block text-xs font-medium text-fg-mute">{m('email')}</span>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" className="h-ctl" />
        </label>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="jira-token" className="text-xs font-medium text-fg-mute">{m('token')}</label>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-xs text-[11px] text-acc-ink hover:underline focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
              onClick={() => { void sdk.openExternal(API_TOKEN_URL).catch(() => {}); }}
            >
              {m('tokenHelp')} <ExternalLink className="h-3 w-3" />
            </button>
          </div>
          <Input
            id="jira-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="current-password"
            placeholder={jira.connected ? m('tokenKeep') : ''}
            className="h-ctl font-mono"
          />
          <span className="block text-[11px] text-fg-mute">{m('tokenSaved')}</span>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="jira-jql" className="text-xs font-medium text-fg-mute">{m('jql')}</label>
            {jql.trim() !== DEFAULT_JQL && (
              <button type="button" className="rounded-xs text-[11px] text-acc-ink hover:underline" onClick={() => setJql(DEFAULT_JQL)}>
                {m('jqlReset')}
              </button>
            )}
          </div>
          <Textarea id="jira-jql" value={jql} onChange={(e) => setJql(e.target.value)} rows={2} className="font-mono text-xs" />
        </div>
        <Toggle label={m('pushStatus')} checked={pushStatus} onChange={setPushStatus} />
        <div className="space-y-1">
          <Toggle label={m('autoLog')} checked={autoLog} onChange={setAutoLog} />
          <p className="text-[11px] text-fg-mute">{m('autoLogHint')}</p>
        </div>
        {cfg?.hiddenKeys && cfg.hiddenKeys.length > 0 && (
          <p className="flex items-center gap-2 text-[11px] text-fg-mute">
            {m('hiddenIssues', { n: cfg.hiddenKeys.length })}
            <button type="button" className="text-acc-ink hover:underline" onClick={() => jira.unhideAll()}>{m('showHidden')}</button>
          </p>
        )}
        {error && <p role="alert" className="text-xs text-bad">{error}</p>}
        <div className="flex items-center gap-2 border-t border-line pt-3">
          {jira.connected && (
            <Button type="button" variant="ghost" size="sm" className="text-xs text-bad" title={m('disconnectHint')} onClick={() => { void jira.disconnect().then(onClose); }}>
              {m('disconnect')}
            </Button>
          )}
          <span className="flex-1" />
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>{m('cancel')}</Button>
          <Button type="submit" size="sm" disabled={!canSave} busy={busy}>{m('testSave')}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** `PAY-123` on a task row/card; opens the issue in the browser. */
export function JiraKeyChip({ task }: { task: Task }) {
  const m = useMessages(MESSAGES);
  const jira = useJira();
  if (!task.jira) return null;
  const failed = !!task.jira.pushError;
  const busy = jira.pushing.has(task.jira.key);
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); jira.openIssue(task); }}
        title={m('openInJira', { key: task.jira.key })}
        aria-label={m('openInJira', { key: task.jira.key })}
        className={cn(
          'rounded-xs px-1 font-mono text-[11px] text-info hover:underline focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
        )}
      >
        {task.jira.key}
      </button>
      {busy && <Spinner size="xs" label={m('pushingStatus')} />}
      {failed && !busy && (
        <AlertTriangle
          className="h-3 w-3 text-warn"
          aria-label={m('pushFailed', { message: task.jira.pushError!.message })}
        />
      )}
    </span>
  );
}

/** Editor section for a linked task. */
export function JiraTaskSection({ task }: { task: Task }) {
  const m = useMessages(MESSAGES);
  const jira = useJira();
  const { entries } = useClockify();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const pending = useMemo(() => pendingWorklogs(entries, task.id), [entries, task.id]);
  const pendingSeconds = pending.reduce((s, e) => s + worklogSeconds(e), 0);
  const trackedAny = entries.some((e) => e.taskId === task.id);
  if (!task.jira) return null;
  const link = task.jira;

  const log = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await jira.logWork(task);
      setNote({ tone: 'ok', text: m('logged', { n: r.count, t: fmtTotal(r.seconds * 1000) }) });
    } catch (e) {
      setNote({ tone: 'bad', text: jiraErrorText(e, m) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 rounded-md border border-line bg-sunk p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-fg-mute">{m('section')}</span>
        <button
          type="button"
          onClick={() => jira.openIssue(task)}
          className="inline-flex items-center gap-1 rounded-xs font-mono text-info hover:underline focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
        >
          {link.key} <ExternalLink className="h-3 w-3" />
        </button>
        {link.issueType && <span className="text-fg-mute">· {link.issueType}</span>}
        <span className="text-fg-mute">· {m('jiraStatus', { status: link.statusName || '—' })}</span>
      </div>
      {link.pushError && (
        <div className="flex items-center gap-2 text-[11px] text-warn">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {m('pushFailed', { message: link.pushError.message.startsWith('no-transition:') ? m('noTransition') : link.pushError.message })}
          </span>
          <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => jira.retryPush(task)}>{m('retry')}</Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-mute">
        {pending.length > 0 && <span>{m('unlogged', { t: fmtTotal(pendingSeconds * 1000) })}</span>}
        {pending.length === 0 && <span>{trackedAny ? m('allLogged') : m('noTime')}</span>}
        <span className="flex-1" />
        {pending.length > 0 && (
          <Button type="button" variant="outline" size="sm" className="text-xs" busy={busy} disabled={!jira.connected} onClick={() => { void log(); }}>
            {m('logWork', { t: fmtTotal(pendingSeconds * 1000) })}
          </Button>
        )}
      </div>
      {note && <p role={note.tone === 'bad' ? 'alert' : 'status'} className={cn('text-[11px]', note.tone === 'ok' ? 'text-ok' : 'text-bad')}>{note.text}</p>}
    </section>
  );
}
