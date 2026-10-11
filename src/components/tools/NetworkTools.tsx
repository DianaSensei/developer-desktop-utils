import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Segmented } from '@/components/ui/segmented';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Globe, Search, RefreshCw, MapPin, Wifi, Building2,
  Network as NetworkIcon, ShieldCheck, ShieldAlert, CheckCircle2, XCircle,
  AlertCircle, Clock, Server, X, Router, Laptop, Plug, Star, Plus, ChevronUp, ChevronDown, Info,
  type LucideIcon,
} from 'lucide-react';
import { Callout } from '@/components/ui/callout';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/search-input';
import { SectionLabel } from '@/components/ui/section-label';
import { Stat, StatGrid } from '@/components/ui/stat';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/platform';
import { useQuickPaste, useQuickPasteHint } from '@/hooks/useQuickPaste';
import { usePluginSdk, usePluginSdkFor, usePluginState } from '@/platform';
import {
  DNS_RECORD_TYPES, DOH_PROVIDERS, DOH_PROVIDER_MAP,
  queryDns, queryAllRecords, checkPropagation, checkDnssec, lookupIp, getLocalNetworkInfo, listListeningPorts,
  type DnsAnswer, type FetchLike, type PropagationRow, type DnssecResult, type IpInfo,
  type LocalNetworkInfo, type PortEntry,
} from '@/lib/network';
import { useMessages } from '@/contexts/LocaleContext';
import { Tooltip } from '@/components/ui/tooltip';
import MESSAGES from '@/components/tools/NetworkTools.messages';

type View = 'dns' | 'propagation' | 'dnssec' | 'myip' | 'iplookup' | 'local' | 'ports';
type Category = 'dns' | 'ip' | 'machine';

// Two-tier navigation: a primary row of categories, then a secondary row of the
// views inside the active category. Each view carries its own icon for quick
// scanning.
interface ViewMeta {
  label: string;
  icon: typeof Globe;
  category: Category;
}

const VIEW_META: Record<View, ViewMeta> = {
  dns:         { label: 'DNS Lookup',    icon: Search,      category: 'dns' },
  propagation: { label: 'Propagation',   icon: Globe,       category: 'dns' },
  dnssec:      { label: 'DNSSEC',        icon: ShieldCheck, category: 'dns' },
  myip:        { label: "What's My IP",  icon: Wifi,        category: 'ip' },
  iplookup:    { label: 'IP Lookup',     icon: MapPin,      category: 'ip' },
  local:       { label: 'Local Network', icon: Router,      category: 'machine' },
  ports:       { label: 'Ports',         icon: Plug,        category: 'machine' },
};

// Flat order used by keyboard navigation (←/→ cycle, number keys jump).
const VIEW_ORDER: View[] = ['dns', 'propagation', 'dnssec', 'myip', 'iplookup', 'local', 'ports'];

const CATEGORIES: { id: Category; label: string; icon: typeof Globe }[] = [
  { id: 'dns', label: 'DNS', icon: Globe },
  { id: 'ip', label: 'IP', icon: MapPin },
  { id: 'machine', label: 'This machine', icon: Laptop },
];

const VIEWS_BY_CATEGORY: Record<Category, View[]> =
  VIEW_ORDER.reduce((acc, v) => {
    (acc[VIEW_META[v].category] ??= []).push(v);
    return acc;
  }, {} as Record<Category, View[]>);

// Remembers the last sub-view visited per category, so re-selecting a category
// returns you to where you were rather than always its first view.
const LAST_VIEW: Record<Category, View> = { dns: 'dns', ip: 'myip', machine: 'local' };

const IS_TAURI = isTauri;

// ─── session store ──────────────────────────────────────────────────────────
// Inputs + results live in a module-level object, not localStorage. This keeps
// every view's state intact across tab switches AND when you leave the Network
// tool and come back (the module stays loaded for the app's lifetime), while a
// fresh app launch starts clean — matching "keep until cleared or fresh start".

// Sortable columns. Some apply only to one view (mem/uptime → processes;
// proto/address → sockets); the other view falls back to sorting by port.
type PortSortCol = 'pid' | 'port' | 'process' | 'mem' | 'uptime' | 'proto' | 'address';
type SortDir = 'asc' | 'desc';
// Grouped = one row per process; flat = one row per listening socket.
type PortViewMode = 'grouped' | 'flat';

const SESSION = {
  nav: { view: 'dns' as View },
  dns: { domain: '', type: 'A', providerId: 'cloudflare', answers: null as DnsAnswer[] | null, status: '', error: '' },
  prop: { domain: '', type: 'A', rows: null as PropagationRow[] | null, error: '' },
  dnssec: { domain: '', result: null as DnssecResult | null, error: '' },
  myip: { info: null as IpInfo | null, error: '' },
  local: { info: null as LocalNetworkInfo | null, error: '' },
  ports: { entries: null as PortEntry[] | null, error: '', filter: '', favOnly: false, viewMode: 'grouped' as PortViewMode, sortCol: 'port' as PortSortCol, sortDir: 'asc' as SortDir },
  iplookup: { ip: '', info: null as IpInfo | null, error: '' },
};

function useSessionState<T>(slot: Record<string, unknown>, key: string): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => slot[key] as T);
  useEffect(() => { slot[key] = value; }, [slot, key, value]);
  return [value, setValue];
}

// ─── shared bits ────────────────────────────────────────────────────────────

function CopyBtn({ value }: { value: string }) {
  return (
    <CopyButton
      value={value}
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0 text-fg-mute/60 hover:text-fg"
      iconClassName="h-3.5 w-3.5"
    />
  );
}

// Bar shown above results: a short summary on the left, a Clear action on the right.
function MetaBar({ summary, onClear }: { summary: React.ReactNode; onClear: () => void }) {
  const m = useMessages(MESSAGES);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-fg-mute">{summary}</span>
      <button
        type="button"
        onClick={onClear}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-mute hover:text-fg hover:bg-bg-2 transition-colors"
      >
        <X className="h-3 w-3" /> {m('clear')}
      </button>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return <Callout tone="error" size="sm">{message}</Callout>;
}

// Nhãn nhỏ cho danh sách kết quả (loại bản ghi DNS, họ địa chỉ, giao thức
// cổng) — dùng `Badge` của kit thay cho bản tự viết trước đây.
const PILL_TONE = { primary: 'accent', muted: 'neutral', amber: 'warning' } as const;
function Pill({ children, tone = 'primary', className }: {
  children: React.ReactNode;
  tone?: keyof typeof PILL_TONE;
  className?: string;
}) {
  return (
    <Badge tone={PILL_TONE[tone]} size="xs" className={cn('w-fit justify-center font-mono font-semibold', className)}>
      {children}
    </Badge>
  );
}

function Empty({ icon = Globe, children }: { icon?: LucideIcon; children: React.ReactNode }) {
  return <EmptyState icon={icon} description={children} className="h-full py-6" />;
}

// Common shell: pinned toolbar on top, scrollable result region below.
function ViewShell({ toolbar, children }: { toolbar: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 shrink-0">{toolbar}</div>
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
    </div>
  );
}

// Self-contained stat card — each is its own bordered box, so an odd number of
// items just leaves clean background (no hollow grid cells).
function StatCard({ icon: Icon, label, value }: { icon: typeof Globe; label: string; value: string }) {
  return (
    <Stat
      mono
      icon={<Icon className="h-3.5 w-3.5 text-fg-mute/70" />}
      label={label}
      value={value}
      action={<CopyBtn value={value} />}
      className="group bg-card"
    />
  );
}

// ─── DNS lookup view ────────────────────────────────────────────────────────

/**
 * `fetch` của Platform cho tool này.
 *
 * Đi qua đây thay vì gọi thẳng `@tauri-apps/plugin-http` để lời gọi chạm đúng
 * một điểm thắt: kiểm host với allowlist khai trong `src/plugins/network/plugin.ts`
 * rồi ghi audit. Tầng capability của Tauri không thay thế được việc này — nó
 * gắn theo webview, mà mọi plugin dùng chung một webview, nên nó buộc phải mở
 * `https://**` cho API Client và vì thế không nói được gì về riêng tool này.
 */
function usePlatformFetch(): FetchLike {
  const sdk = usePluginSdk();
  return useCallback<FetchLike>((input, init) => sdk.http.fetch(input, init), [sdk]);
}

function DnsView() {
  const m = useMessages(MESSAGES);
  const quickPasteHint = useQuickPasteHint();
  const httpFetch = usePlatformFetch();
  const [domain, setDomain] = useSessionState<string>(SESSION.dns, 'domain');
  const [type, setType] = useSessionState<string>(SESSION.dns, 'type');
  const [providerId, setProviderId] = useSessionState<string>(SESSION.dns, 'providerId');
  const [answers, setAnswers] = useSessionState<DnsAnswer[] | null>(SESSION.dns, 'answers');
  const [status, setStatus] = useSessionState<string>(SESSION.dns, 'status');
  const [error, setError] = useSessionState<string>(SESSION.dns, 'error');
  const [loading, setLoading] = useState(false);

  useQuickPaste(setDomain);

  const run = useCallback(async () => {
    const name = domain.trim();
    if (!name) return;
    setLoading(true); setError(''); setAnswers(null);
    try {
      const provider = DOH_PROVIDER_MAP.get(providerId) ?? DOH_PROVIDERS[0];
      const res = type === 'ALL'
        ? await queryAllRecords(name, provider, undefined, httpFetch)
        : await queryDns(name, type, provider, false, undefined, httpFetch);
      setStatus(res.statusName);
      setAnswers(res.answers);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [domain, type, providerId, httpFetch, setAnswers, setError, setStatus]);

  const clear = () => { setDomain(''); setAnswers(null); setStatus(''); setError(''); };

  return (
    <ViewShell
      toolbar={
        <>
          <SearchInput icon={Globe} value={domain} onChange={setDomain} placeholder={m('domainPlaceholder', { hint: quickPasteHint })} onKeyDown={(e) => e.key === 'Enter' && run()} containerClassName="flex-1 min-w-[200px]" className="h-ctl-lg text-sm" spellCheck={false} autoComplete="off" />
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-ctl-lg w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DNS_RECORD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              <SelectItem value="ALL">ALL</SelectItem>
            </SelectContent>
          </Select>
          <Select value={providerId} onValueChange={setProviderId}>
            <SelectTrigger className="h-ctl-lg w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DOH_PROVIDERS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={run} disabled={loading || !domain.trim()} className="h-ctl-lg gap-1.5">
            {loading ? <Spinner /> : <Search className="h-4 w-4" />}
            {m('lookup')}
          </Button>
        </>
      }
    >
      {error ? <ErrorBox message={error} /> : answers ? (
        <div className="space-y-2">
          <MetaBar
            summary={`${m(answers.length === 1 ? 'recordsOne' : 'records', { n: answers.length })}${status && status !== 'NOERROR' ? ` · ${status}` : ''}`}
            onClear={clear}
          />
          {answers.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border bg-bg-2/30 px-3 py-2.5 text-xs text-fg-mute">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No {type} records found{status && status !== 'NOERROR' ? ` · ${status}` : ''}.
            </div>
          ) : (
            <div className="grid gap-1.5 lg:grid-cols-2">
              {answers.map((a, i) => (
                <div key={i} className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
                  <Pill className="shrink-0 w-12">{a.typeName}</Pill>
                  <span className="flex-1 font-mono text-xs break-all">{a.data}</span>
                  <span className="shrink-0 text-[11px] text-fg-mute tabular-nums" title={m('ttlSeconds')}>{a.ttl}s</span>
                  <CopyBtn value={a.data} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : !loading ? (
        <Empty>{m('dnsEmpty')}</Empty>
      ) : null}
    </ViewShell>
  );
}

// ─── propagation view ───────────────────────────────────────────────────────

function PropagationView() {
  const m = useMessages(MESSAGES);
  const quickPasteHint = useQuickPasteHint();
  const httpFetch = usePlatformFetch();
  const [domain, setDomain] = useSessionState<string>(SESSION.prop, 'domain');
  const [type, setType] = useSessionState<string>(SESSION.prop, 'type');
  const [rows, setRows] = useSessionState<PropagationRow[] | null>(SESSION.prop, 'rows');
  const [error, setError] = useSessionState<string>(SESSION.prop, 'error');
  const [loading, setLoading] = useState(false);

  useQuickPaste(setDomain);

  const run = useCallback(async () => {
    const name = domain.trim();
    if (!name) return;
    setLoading(true); setError(''); setRows(null);
    try {
      setRows(await checkPropagation(name, type, undefined, httpFetch));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [domain, type, httpFetch, setRows, setError]);

  const clear = () => { setDomain(''); setRows(null); setError(''); };

  const consistent = rows
    ? (() => {
        const ok = rows.filter((r) => r.ok);
        if (ok.length < 2) return null;
        const first = JSON.stringify(ok[0].records);
        return ok.every((r) => JSON.stringify(r.records) === first);
      })()
    : null;

  return (
    <ViewShell
      toolbar={
        <>
          <SearchInput icon={Globe} value={domain} onChange={setDomain} placeholder={m('domainPlaceholder', { hint: quickPasteHint })} onKeyDown={(e) => e.key === 'Enter' && run()} containerClassName="flex-1 min-w-[200px]" className="h-ctl-lg text-sm" spellCheck={false} autoComplete="off" />
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-ctl-lg w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DNS_RECORD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={run} disabled={loading || !domain.trim()} className="h-ctl-lg gap-1.5">
            {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
            {m('check')}
          </Button>
        </>
      }
    >
      {error ? <ErrorBox message={error} /> : rows ? (
        <div className="space-y-2">
          <MetaBar summary={m('acrossResolvers', { type, n: rows.length })} onClear={clear} />
          {consistent !== null && (
            <Callout
              tone={consistent ? 'success' : 'warning'}
              size="sm"
              icon={consistent ? CheckCircle2 : AlertCircle}
              className="font-medium"
            >
              {consistent ? m('propagated') : m('notPropagated')}
            </Callout>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.provider.id} className="rounded-lg border bg-card px-3 py-2.5">
                <div className="flex items-center gap-2">
                  {r.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" /> : <XCircle className="h-4 w-4 shrink-0 text-bad" />}
                  <span className="text-sm font-medium">{r.provider.label}</span>
                  {r.status && r.status !== 'NOERROR' && <span className="ml-auto text-[11px] text-fg-mute">{r.status}</span>}
                </div>
                {r.error ? (
                  <p className="mt-1.5 pl-6 text-xs text-bad">{r.error}</p>
                ) : r.records.length ? (
                  <div className="mt-1.5 pl-6 space-y-1">
                    {r.records.map((rec, i) => <div key={i} className="font-mono text-xs break-all text-fg-mute">{rec}</div>)}
                  </div>
                ) : (
                  <p className="mt-1.5 pl-6 text-xs text-fg-mute">No {type} records</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : !loading ? (
        <Empty icon={NetworkIcon}>{m('propagationEmpty')}</Empty>
      ) : null}
    </ViewShell>
  );
}

// ─── DNSSEC view ────────────────────────────────────────────────────────────

function DnssecSection({ title, records }: { title: string; records: DnsAnswer[] }) {
  if (!records.length) return null;
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold">{title}</span>
        <span className="rounded bg-bg-2 px-1.5 py-0.5 text-[11px] text-fg-mute">{records.length}</span>
      </div>
      <div className="space-y-1">
        {records.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="flex-1 font-mono text-[11px] break-all text-fg-mute">{r.data}</span>
            <CopyBtn value={r.data} />
          </div>
        ))}
      </div>
    </div>
  );
}

function DnssecView() {
  const m = useMessages(MESSAGES);
  const quickPasteHint = useQuickPasteHint();
  const httpFetch = usePlatformFetch();
  const [domain, setDomain] = useSessionState<string>(SESSION.dnssec, 'domain');
  const [result, setResult] = useSessionState<DnssecResult | null>(SESSION.dnssec, 'result');
  const [error, setError] = useSessionState<string>(SESSION.dnssec, 'error');
  const [loading, setLoading] = useState(false);

  useQuickPaste(setDomain);

  const run = useCallback(async () => {
    const name = domain.trim();
    if (!name) return;
    setLoading(true); setError(''); setResult(null);
    try {
      setResult(await checkDnssec(name, undefined, undefined, httpFetch));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [domain, httpFetch, setResult, setError]);

  const clear = () => { setDomain(''); setResult(null); setError(''); };
  const hasData = result && (result.ds.length || result.dnskey.length || result.rrsig.length);

  return (
    <ViewShell
      toolbar={
        <>
          <SearchInput icon={Globe} value={domain} onChange={setDomain} placeholder={m('domainPlaceholder', { hint: quickPasteHint })} onKeyDown={(e) => e.key === 'Enter' && run()} containerClassName="flex-1 min-w-[200px]" className="h-ctl-lg text-sm" spellCheck={false} autoComplete="off" />
          <Button onClick={run} disabled={loading || !domain.trim()} className="h-ctl-lg gap-1.5">
            {loading ? <Spinner /> : <ShieldCheck className="h-4 w-4" />}
            {m('check')}
          </Button>
        </>
      }
    >
      {error ? <ErrorBox message={error} /> : result ? (
        <div className="space-y-2">
          <MetaBar summary={m('dnssecChain')} onClear={clear} />
          <Callout
            tone={result.validated ? 'success' : 'warning'}
            icon={result.validated ? ShieldCheck : ShieldAlert}
            className="font-medium"
          >
            {result.validated
              ? m('dnssecValid')
              : m('dnssecInvalid')}
          </Callout>
          {hasData ? (
            <div className="space-y-2">
              <div className="grid gap-2 lg:grid-cols-2">
                <DnssecSection title={m('dsRecords')} records={result.ds} />
                <DnssecSection title={m('dnskeyRecords')} records={result.dnskey} />
              </div>
              <DnssecSection title={m('rrsigSignatures')} records={result.rrsig} />
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border bg-bg-2/30 px-3 py-2.5 text-xs text-fg-mute">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {m('noDnssecRecords')}
            </div>
          )}
        </div>
      ) : !loading ? (
        <Empty icon={ShieldCheck}>{m('dnssecEmpty')}</Empty>
      ) : null}
    </ViewShell>
  );
}

// ─── IP info card (shared by My IP + IP Lookup) ─────────────────────────────

function IpCard({ info }: { info: IpInfo }) {
  const m = useMessages(MESSAGES);
  const fields: { label: string; value: string; icon: typeof Globe }[] = [
    { label: m('ipAddress'), value: `${info.ip}${info.type ? `  (${info.type})` : ''}`, icon: NetworkIcon },
    { label: m('location'), value: [info.city, info.region, `${info.country} ${info.flag}`].filter((s) => s && s.trim()).join(', '), icon: MapPin },
    { label: m('coordinates'), value: info.lat || info.lon ? `${info.lat}, ${info.lon}` : '', icon: Globe },
    { label: m('timezone'), value: info.timezone, icon: Clock },
    { label: m('isp'), value: info.isp, icon: Wifi },
    { label: m('organization'), value: info.org, icon: Building2 },
    { label: m('asn'), value: info.asn, icon: Server },
  ].filter((r) => r.value);

  return (
    <StatGrid>
      {fields.map((f) => <StatCard key={f.label} icon={f.icon} label={f.label} value={f.value} />)}
    </StatGrid>
  );
}

// ─── My IP view ─────────────────────────────────────────────────────────────

function MyIpView() {
  const m = useMessages(MESSAGES);
  const httpFetch = usePlatformFetch();
  const [info, setInfo] = useSessionState<IpInfo | null>(SESSION.myip, 'info');
  const [error, setError] = useSessionState<string>(SESSION.myip, 'error');
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true); setError(''); setInfo(null);
    try {
      setInfo(await lookupIp('', undefined, httpFetch));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [httpFetch, setInfo, setError]);

  const clear = () => { setInfo(null); setError(''); };

  return (
    <ViewShell
      toolbar={
        <>
          <Button onClick={run} disabled={loading} className="h-ctl-lg gap-1.5">
            {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
            {info ? m('refresh') : m('detectMyIp')}
          </Button>
          {info && (
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-2xl font-semibold">{info.ip}</span>
              {info.flag && <span className="text-xl">{info.flag}</span>}
            </div>
          )}
        </>
      }
    >
      {error ? <ErrorBox message={error} /> : info ? (
        <div className="space-y-2">
          <MetaBar summary={m('yourPublicIp')} onClear={clear} />
          <IpCard info={info} />
        </div>
      ) : !loading ? (
        <Empty icon={NetworkIcon}>{m('myIpEmpty')}</Empty>
      ) : null}
    </ViewShell>
  );
}

// ─── Local Network view (desktop only) ──────────────────────────────────────

function LocalNetworkView() {
  const m = useMessages(MESSAGES);
  const [info, setInfo] = useSessionState<LocalNetworkInfo | null>(SESSION.local, 'info');
  const [error, setError] = useSessionState<string>(SESSION.local, 'error');
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true); setError(''); setInfo(null);
    try {
      setInfo(await getLocalNetworkInfo());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [setInfo, setError]);

  // Local read is instant and side-effect-free — load it automatically the first
  // time the view is opened (in the desktop app), but keep the manual Refresh.
  useEffect(() => {
    if (IS_TAURI && !SESSION.local.info && !SESSION.local.error) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clear = () => { setInfo(null); setError(''); };

  const summary = info ? [
    { label: m('hostname'), value: info.hostname, icon: Laptop },
    { label: m('primaryIpv4'), value: info.primaryIpv4 ?? '', icon: NetworkIcon },
    { label: m('primaryIpv6'), value: info.primaryIpv6 ?? '', icon: NetworkIcon },
  ].filter((f) => f.value) : [];

  return (
    <ViewShell
      toolbar={
        <>
          <Button onClick={run} disabled={loading || !IS_TAURI} className="h-ctl-lg gap-1.5">
            {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
            {info ? m('refresh') : m('detectLocal')}
          </Button>
          {info?.hostname && (
            <span className="font-mono text-lg font-semibold">{info.hostname}</span>
          )}
        </>
      }
    >
      {!IS_TAURI ? (
        <Empty icon={Router}>{m('desktopOnlyLocal')}</Empty>
      ) : error ? <ErrorBox message={error} /> : info ? (
        <div className="space-y-2.5">
          <MetaBar summary={m('readLocally')} onClear={clear} />
          <StatGrid>
            {summary.map((f) => <StatCard key={f.label} icon={f.icon} label={f.label} value={f.value} />)}
          </StatGrid>

          {info.interfaces.length > 0 && (
            <>
              <SectionLabel rule className="px-0.5 pt-1" count={info.interfaces.length}>{m('interfaces')}</SectionLabel>
              <div className="grid gap-1.5 lg:grid-cols-2">
                {info.interfaces.map((iface, i) => (
                  <div
                    key={`${iface.name}-${iface.ip}-${i}`}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2',
                      iface.internal && 'opacity-60',
                    )}
                  >
                    <Pill className="shrink-0 w-12">{iface.family === 'IPv6' ? 'v6' : 'v4'}</Pill>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-fg-mute">
                        {iface.name}{iface.internal && m('internal')}
                      </p>
                      <p className="font-mono text-xs break-all">{iface.ip}</p>
                    </div>
                    <CopyBtn value={iface.ip} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : !loading ? (
        <Empty icon={Router}>{m('localEmpty')}</Empty>
      ) : null}
    </ViewShell>
  );
}

// ─── Ports view (desktop only) ───────────────────────────────────────────────

const PORTS_GRID = 'grid grid-cols-[32px_64px_60px_minmax(0,2fr)_72px_minmax(0,2fr)] items-center gap-2';

// A rendered row is either a live socket or a favourite port that isn't
// currently listening (shown so devs can see "is 3000 free?" at a glance).
type PortRow =
  | { kind: 'socket'; entry: PortEntry }
  | { kind: 'free'; port: number };

// One listening process and the port(s) it's bound to — the unit of the default
// process-grouped view.
// A distinct listening endpoint of a process: one port+protocol, plus every
// address it's bound to (e.g. both 0.0.0.0 and ::, or 127.0.0.1 + a LAN IP).
interface PortChip {
  port: number;
  protocol: string;
  addresses: string[];
}

interface ProcGroup {
  key: string;
  pid: number | null;
  processName: string | null;
  memBytes: number | null;
  uptimeSecs: number | null;
  project: string | null;
  framework: string | null;
  command: string | null;
  ports: PortChip[];
}

// Classify the addresses a port is bound to into a short reachability scope.
type ScopeLabel = 'local' | 'LAN' | 'all';

// Mô tả từng phạm vi nằm trong NetworkTools.messages.ts (`scope.local`…).

function bindScope(addresses: string[]): { label: ScopeLabel; exposed: boolean } {
  const isWild = (a: string) => a === '0.0.0.0' || a === '::';
  const isLoop = (a: string) => a === '::1' || a.startsWith('127.');
  if (addresses.some(isWild)) return { label: 'all', exposed: true };
  if (addresses.every(isLoop)) return { label: 'local', exposed: false };
  return { label: 'LAN', exposed: true };
}

// A recognisable glyph per framework/runtime. Falls back to a neutral dot.
const FRAMEWORK_EMOJI: Record<string, string> = {
  'Next.js': '⚡', Nuxt: '💚', NestJS: '🐱', Vite: '⚡', Remix: '💿', Astro: '🚀',
  'Create React App': '⚛️', React: '⚛️', Vue: '💚', Angular: '🅰️',
  Express: '🚂', Fastify: '🛤️', Koa: '🌊', Hapi: '🎉',
  Django: '🎸', Flask: '🧪', Gunicorn: '🦄', Uvicorn: '🦄', Celery: '🥬', Python: '🐍',
  Rails: '💎', Puma: '🐾', Ruby: '💎', Java: '☕', Node: '🟢',
  Docker: '🐳', Postgres: '🐘', MySQL: '🐬', MariaDB: '🐬', Redis: '🧱', MongoDB: '🍃',
};

// Format resident memory (raw bytes from sysinfo) in 1024-based units — the
// binary convention `top` / `htop` use — labelled KB/MB/GB for readability.
function formatMem(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Shared column template — header and every row use it so columns line up into
// a clean, self-explanatory table:  PID · PORT · SCOPE · PROCESS · MEM · UPTIME
const PROC_GRID = 'grid grid-cols-[52px_96px_64px_minmax(0,1fr)_56px_60px] items-start gap-x-3';

// One process row. Minimalist and column-aligned: a bold port (the thing devs
// scan by) anchors the left, the project/process name + its command identify it,
// and memory / uptime / pid sit quietly in their own right-aligned columns.
function ProcessRow({ group, isFav, onToggleFav }: {
  group: ProcGroup;
  isFav: (port: number) => boolean;
  onToggleFav: (port: number) => void;
}) {
  const m = useMessages(MESSAGES);
  const emoji = group.framework ? FRAMEWORK_EMOJI[group.framework] : undefined;
  const title = group.project ?? group.processName ?? '—';
  // Show the command; if the title already came from the project, keep the
  // process name visible too when there's no command.
  const subtitle = group.command ?? (group.project ? group.processName : null);
  const [cmdOpen, setCmdOpen] = useState(false);

  return (
    <div className={cn(PROC_GRID, 'px-3 py-2')}>
      {/* PID — first column */}
      <span className="py-0.5 font-mono text-[11px] tabular-nums text-fg-mute" title={m('processId')}>
        {group.pid != null ? group.pid : '—'}
      </span>

      {/* PORT — every port is its own chip, each a favourite toggle. The first
          (lowest) port is the anchor; the rest stack beneath it. */}
      <div className="flex flex-col gap-1.5">
        {group.ports.map((p, i) => {
          const fav = isFav(p.port);
          return (
            <button
              key={`${p.protocol}-${p.port}`}
              type="button"
              onClick={() => onToggleFav(p.port)}
              aria-pressed={fav}
              title={m('portOnFav', { port: p.port, proto: p.protocol, addr: p.addresses.join(', '), action: fav ? m('removeFromFav') : m('addToFav') })}
              className="group/port flex h-5 items-center gap-1.5 text-left"
            >
              <Star className={cn('h-3 w-3 shrink-0', fav ? 'fill-current text-warn' : 'text-transparent group-hover/port:text-fg-mute/40')} />
              <span className={cn(
                'w-10 font-mono text-xs tabular-nums',
                i === 0 ? 'font-semibold' : 'font-medium',
                fav ? 'text-warn' : i === 0 ? 'text-fg' : 'text-fg-mute',
              )}>
                {p.port}
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-fg-mute/40">{p.protocol}</span>
            </button>
          );
        })}
      </div>

      {/* SCOPE — dedicated column, one quiet dot + label per port, aligned with
          the port chips. Hover any cell (or the header) for what it means. */}
      <div className="flex flex-col gap-1.5">
        {group.ports.map((p) => {
          const scope = bindScope(p.addresses);
          return (
            <span
              key={`${p.protocol}-${p.port}`}
              className={cn(
                'flex h-5 items-center gap-1.5 text-[11px] font-medium',
                scope.exposed ? 'text-warn' : 'text-fg-mute/50',
              )}
              title={`${m(`scope.${scope.label}`)} — ${p.addresses.join(', ')}`}
            >
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', scope.exposed ? 'bg-warn' : 'bg-fg-mute/30')} />
              {scope.label}
            </span>
          );
        })}
      </div>

      {/* PROCESS — name + framework + (exposed) on top, command beneath */}
      <div className="min-w-0 py-0.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium" title={title}>{title}</span>
          {group.framework && (
            <span className="shrink-0 text-[11px] text-fg-mute" title={m('detectedFramework')}>
              {emoji && <span aria-hidden>{emoji} </span>}{group.framework}
            </span>
          )}
        </div>
        {subtitle && (
          <div className="group/cmd flex items-start gap-1">
            <button
              type="button"
              onClick={() => setCmdOpen((o) => !o)}
              title={cmdOpen ? m('collapse') : m('showCommand')}
              className={cn(
                'min-w-0 flex-1 text-left font-mono text-[11px] leading-tight text-fg-mute/70 hover:text-fg-mute',
                cmdOpen ? 'whitespace-pre-wrap break-all' : 'truncate',
              )}
            >
              {subtitle}
            </button>
            <CopyButton
              value={subtitle}
              iconClassName="h-3 w-3"
              className="h-5 w-5 shrink-0 text-fg-mute/50 opacity-0 transition-opacity hover:text-fg group-hover/cmd:opacity-100"
            />
          </div>
        )}
      </div>

      {/* MEM · UPTIME — quiet, right-aligned metric columns */}
      <span className="py-0.5 text-right font-mono text-xs tabular-nums text-fg-mute" title={m('residentMemory')}>
        {group.memBytes != null ? formatMem(group.memBytes) : ''}
      </span>
      <span className="py-0.5 text-right text-[11px] tabular-nums text-fg-mute" title={m('uptime')}>
        {group.uptimeSecs != null ? formatUptime(group.uptimeSecs) : ''}
      </span>
    </div>
  );
}

// Small star toggle used by the socket (flat / favourites) rows.
function FavStar({ port, fav, onToggle }: { port: number; fav: boolean; onToggle: (port: number) => void }) {
  const m = useMessages(MESSAGES);
  return (
    <button
      type="button"
      onClick={() => onToggle(port)}
      aria-pressed={fav}
      title={fav ? m('removePortFav', { port }) : m('addPortFav', { port })}
      className={cn(
        'group/star flex h-6 w-6 items-center justify-center rounded transition-colors',
        fav ? 'text-warn' : 'text-fg-mute/40 hover:text-fg-mute',
      )}
    >
      <Star className={cn('h-3.5 w-3.5', fav && 'fill-current')} />
    </button>
  );
}

// One row per listening socket — the "flat" layout (and the favourites
// watchlist): Port · Proto · Process · PID · Address.
function SocketRow({ entry, isFav, onToggleFav }: {
  entry: PortEntry;
  isFav: (port: number) => boolean;
  onToggleFav: (port: number) => void;
}) {
  return (
    <div className={cn(PORTS_GRID, 'px-3 py-1.5 text-xs')}>
      <FavStar port={entry.localPort} fav={isFav(entry.localPort)} onToggle={onToggleFav} />
      <span className="font-mono font-semibold tabular-nums">{entry.localPort}</span>
      <Pill tone={entry.protocol === 'UDP' ? 'amber' : 'primary'}>{entry.protocol}</Pill>
      <span className="truncate" title={entry.processName ?? undefined}>{entry.processName ?? '—'}</span>
      <span className="font-mono tabular-nums text-fg-mute">{entry.pid ?? '—'}</span>
      <span className="truncate font-mono text-fg-mute" title={entry.localAddress}>{entry.localAddress}</span>
    </div>
  );
}

// A favourite port that isn't currently listening (favourites watchlist only).
function FreeRow({ port, fav, onToggle }: { port: number; fav: boolean; onToggle: (port: number) => void }) {
  const m = useMessages(MESSAGES);
  return (
    <div className={cn(PORTS_GRID, 'px-3 py-1.5 text-xs opacity-60')}>
      <FavStar port={port} fav={fav} onToggle={onToggle} />
      <span className="font-mono font-semibold tabular-nums">{port}</span>
      <Pill tone="muted">{m('free')}</Pill>
      <span className="italic text-fg-mute">{m('notListening')}</span>
      <span className="text-fg-mute">—</span>
      <span className="text-fg-mute">—</span>
    </div>
  );
}

// Header row for the socket (flat / favourites) table.
function SocketTableHeader() {
  const m = useMessages(MESSAGES);
  return (
    <div className={cn(PORTS_GRID, 'border-b bg-bg-2/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-mute')}>
      {/* Empty placeholder for the star column — must stay in flow so it occupies
          its grid track (an sr-only span is position:absolute and would shift
          every following header one column to the left). */}
      <span aria-hidden="true" />
      <span>{m('port')}</span><span>{m('proto')}</span><span>{m('process')}</span><span>{m('pid')}</span><span>{m('address')}</span>
    </div>
  );
}

function PortsView() {
  const m = useMessages(MESSAGES);
  const sdk = usePluginSdkFor('network');
  const [entries, setEntries] = useSessionState<PortEntry[] | null>(SESSION.ports, 'entries');
  const [error, setError] = useSessionState<string>(SESSION.ports, 'error');
  const [filter, setFilter] = useSessionState<string>(SESSION.ports, 'filter');
  const [favOnly, setFavOnly] = useSessionState<boolean>(SESSION.ports, 'favOnly');
  const [viewMode, setViewMode] = useSessionState<PortViewMode>(SESSION.ports, 'viewMode');
  const [sortCol, setSortCol] = useSessionState<PortSortCol>(SESSION.ports, 'sortCol');
  const [sortDir, setSortDir] = useSessionState<SortDir>(SESSION.ports, 'sortDir');
  // Favourites are a user preference, so they persist across app restarts
  // (unlike scan results, which live in the in-memory session store).
  const [favorites, setFavorites] = usePluginState<number[]>(sdk, 'network:favoritePorts', [], { legacyKey: 'devtool:network:favoritePorts' });
  const [addValue, setAddValue] = useState('');
  const [loading, setLoading] = useState(false);

  const favSet = new Set(favorites);
  const isFav = (port: number) => favSet.has(port);
  const toggleFav = (port: number) =>
    setFavorites((prev) => (prev.includes(port) ? prev.filter((p) => p !== port) : [...prev, port].sort((a, b) => a - b)));

  const addFavorite = () => {
    const port = Number(addValue.trim());
    if (!Number.isInteger(port) || port < 0 || port > 65535) return;
    if (!favSet.has(port)) setFavorites((prev) => [...prev, port].sort((a, b) => a - b));
    setAddValue('');
  };

  const run = useCallback(async () => {
    setLoading(true); setError(''); setEntries(null);
    try {
      setEntries(await listListeningPorts());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [setEntries, setError]);

  // Reading local sockets is fast and side-effect-free — scan automatically the
  // first time the view opens (desktop only), but keep the manual Refresh.
  useEffect(() => {
    if (IS_TAURI && !SESSION.ports.entries && !SESSION.ports.error) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clear = () => { setEntries(null); setError(''); setFilter(''); };

  const q = filter.trim().toLowerCase();
  const matchesFilter = (e: PortEntry) =>
    !q ||
    String(e.localPort).includes(q) ||
    e.protocol.toLowerCase().includes(q) ||
    e.localAddress.toLowerCase().includes(q) ||
    (e.processName ?? '').toLowerCase().includes(q) ||
    (e.framework ?? '').toLowerCase().includes(q) ||
    (e.project ?? '').toLowerCase().includes(q) ||
    (e.command ?? '').toLowerCase().includes(q) ||
    (e.pid != null && String(e.pid).includes(q));

  // Filtering/grouping/sorting below used to run inline in the render body —
  // recomputed on EVERY render, including ones triggered by unrelated state
  // (typing in the "add favorite" input, e.g.) even though `entries`/`filter`/
  // `favorites`/`sortCol`/`sortDir` hadn't changed. Memoized so each stage only
  // redoes work when its own inputs actually change.
  const scanned = useMemo(() => (entries ?? []).filter(matchesFilter), [entries, q]);

  // Favourites mode is a port-centric watchlist: list every favourite port with
  // its live socket(s), or a synthetic "free" row when nothing is bound to it.
  const favRows: PortRow[] = useMemo(
    () =>
      favorites
        .filter((port) => !q || String(port).includes(q))
        .flatMap((port): PortRow[] => {
          const matches = scanned.filter((e) => e.localPort === port);
          return matches.length ? matches.map((entry) => ({ kind: 'socket', entry })) : [{ kind: 'free', port }];
        }),
    [favorites, q, scanned]
  );

  // Default mode groups sockets by owning process (one row per process), so a
  // server listening on several ports shows once with all its ports as chips.
  const groups: ProcGroup[] = useMemo(() => {
    const map = new Map<string, ProcGroup>();
    for (const e of scanned) {
      const key = e.pid != null
        ? `pid-${e.pid}`
        : `sock-${e.family}-${e.localAddress}-${e.localPort}-${e.protocol}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key, pid: e.pid, processName: e.processName, memBytes: e.memBytes,
          uptimeSecs: e.uptimeSecs, project: e.project, framework: e.framework,
          command: e.command, ports: [],
        };
        map.set(key, g);
      }
      const chip = g.ports.find((p) => p.port === e.localPort && p.protocol === e.protocol);
      if (chip) {
        if (!chip.addresses.includes(e.localAddress)) chip.addresses.push(e.localAddress);
      } else {
        g.ports.push({ port: e.localPort, protocol: e.protocol, addresses: [e.localAddress] });
      }
    }
    const arr = [...map.values()];
    for (const g of arr) g.ports.sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));
    return arr;
  }, [scanned]);

  // Sort by the active column for both views. Missing numeric values (e.g. a
  // socket with no resolvable process) always sink to the bottom regardless of
  // direction, so empty cells never interrupt the ordering.
  const dir = sortDir === 'asc' ? 1 : -1;
  const cmpNum = (a: number | null, b: number | null) => {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return (a - b) * dir;
  };
  const cmpStr = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase()) * dir;

  const sortedGroups = useMemo(
    () =>
      [...groups].sort((a, b) => {
        switch (sortCol) {
          case 'pid': return cmpNum(a.pid, b.pid);
          case 'mem': return cmpNum(a.memBytes, b.memBytes);
          case 'uptime': return cmpNum(a.uptimeSecs, b.uptimeSecs);
          case 'process': return cmpStr(a.project ?? a.processName ?? '', b.project ?? b.processName ?? '');
          case 'port':
          default: return ((a.ports[0]?.port ?? 0) - (b.ports[0]?.port ?? 0)) * dir;
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, sortCol, dir]
  );

  // Flat view: one row per socket, sorted by the same active column.
  const sortedSockets = useMemo(
    () =>
      [...scanned].sort((a, b) => {
        switch (sortCol) {
          case 'pid': return cmpNum(a.pid, b.pid);
          case 'mem': return cmpNum(a.memBytes, b.memBytes);
          case 'uptime': return cmpNum(a.uptimeSecs, b.uptimeSecs);
          case 'process': return cmpStr(a.processName ?? '', b.processName ?? '');
          case 'proto': return cmpStr(a.protocol, b.protocol) || (a.localPort - b.localPort) * dir;
          case 'address': return cmpStr(a.localAddress, b.localAddress) || (a.localPort - b.localPort) * dir;
          case 'port':
          default: return (a.localPort - b.localPort) * dir;
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scanned, sortCol, dir]
  );

  // Numeric columns default to descending (biggest/longest first) on first click.
  const DEFAULT_DIR: Record<PortSortCol, SortDir> = {
    pid: 'asc', port: 'asc', process: 'asc', mem: 'desc', uptime: 'desc', proto: 'asc', address: 'asc',
  };
  const toggleSort = (col: PortSortCol) => {
    if (col === sortCol) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir(DEFAULT_DIR[col]); }
  };
  const sortHeader = (col: PortSortCol, label: string, alignRight?: boolean, className?: string) => {
    // The chevron occupies a fixed slot whether active or not, so the label
    // never shifts. For right-aligned columns it goes on the LEFT of the label
    // so the label's right edge lines up with the right-aligned data below it.
    const chevron = sortCol === col
      ? (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
      : <ChevronUp className="h-3 w-3 opacity-0" />;
    return (
      <button
        type="button"
        onClick={() => toggleSort(col)}
        className={cn(
          'flex items-center gap-0.5 uppercase tracking-wide transition-colors hover:text-fg',
          alignRight && 'justify-end',
          sortCol === col && 'text-fg',
          className,
        )}
      >
        {alignRight && chevron}
        {label}
        {!alignRight && chevron}
      </button>
    );
  };

  const favBtnActive = favOnly && 'border-acc/40 bg-acc/10 text-acc';

  return (
    <ViewShell
      toolbar={
        <>
          <Button onClick={run} disabled={loading || !IS_TAURI} className="h-ctl-lg gap-1.5">
            {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
            {entries ? m('refresh') : m('scanPorts')}
          </Button>
          {!favOnly && (
            <Segmented
              value={viewMode}
              onValueChange={(v) => setViewMode(v as PortViewMode)}
              options={[{ value: 'grouped', label: m('processes') }, { value: 'flat', label: m('sockets') }]}
              aria-label={m('groupByLabel')}
            />
          )}
          <Button
            variant="outline"
            onClick={() => setFavOnly((v) => !v)}
            className={cn('h-ctl-lg gap-1.5', favBtnActive)}
            title={m('favOnlyHint')}
            aria-pressed={favOnly}
          >
            <Star className={cn('h-4 w-4', favOnly && 'fill-current')} />
            {m('favourites')}{favorites.length > 0 ? ` (${favorites.length})` : ''}
          </Button>
          {favOnly ? (
            <div className="relative flex-1 min-w-[160px]">
              <Plus className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-mute/60" />
              <Input
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addFavorite()}
                placeholder={m('addPortPlaceholder')}
                aria-label={m('addPortPlaceholder')}
                inputMode="numeric"
                className="h-ctl-lg pl-9 text-sm font-mono"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          ) : entries && entries.length > 0 ? (
            <SearchInput value={filter} onChange={setFilter} icon={Search} placeholder={m('filterPlaceholder')} containerClassName="flex-1 min-w-[200px]" className="h-ctl-lg text-sm" spellCheck={false} autoComplete="off" />
          ) : null}
        </>
      }
    >
      {!IS_TAURI ? (
        <Empty icon={Plug}>{m('desktopOnlyPorts')}</Empty>
      ) : error ? <ErrorBox message={error} /> : favOnly && favorites.length === 0 ? (
        <Empty icon={Star}>{m('noFavPorts')}</Empty>
      ) : entries ? (
        <div className="space-y-2.5">
          <MetaBar
            summary={
              favOnly
                ? m(favorites.length === 1 ? 'favSummaryOne' : 'favSummary', { n: favorites.length })
                : m('portsSummary', {
                    procs: groups.length,
                    sockets: filter.trim() ? m('socketsOf', { shown: scanned.length, total: entries.length }) : scanned.length,
                  })
            }
            onClear={clear}
          />
          {favOnly ? (
            favRows.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-fg-mute">{m('noFavMatch', { filter })}</p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <SocketTableHeader />
                <div className="divide-y">
                  {favRows.map((row, i) => row.kind === 'socket' ? (
                    <SocketRow key={`${row.entry.protocol}-${row.entry.family}-${row.entry.localAddress}-${row.entry.localPort}-${i}`} entry={row.entry} isFav={isFav} onToggleFav={toggleFav} />
                  ) : (
                    <FreeRow key={`free-${row.port}`} port={row.port} fav={isFav(row.port)} onToggle={toggleFav} />
                  ))}
                </div>
              </div>
            )
          ) : viewMode === 'flat' ? (
            sortedSockets.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-fg-mute">
                {entries.length === 0 ? m('noListening') : m('nothingMatches', { filter })}
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <div className={cn(PORTS_GRID, 'border-b bg-bg-2/40 px-3 py-1.5 text-[11px] font-semibold text-fg-mute')}>
                  <span aria-hidden="true" />
                  {sortHeader('port', m('port'))}
                  {sortHeader('proto', m('proto'))}
                  {sortHeader('process', m('process'))}
                  {sortHeader('pid', m('pid'))}
                  {sortHeader('address', m('address'))}
                </div>
                <div className="divide-y">
                  {sortedSockets.map((e, i) => (
                    <SocketRow key={`${e.protocol}-${e.family}-${e.localAddress}-${e.localPort}-${i}`} entry={e} isFav={isFav} onToggleFav={toggleFav} />
                  ))}
                </div>
              </div>
            )
          ) : groups.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-fg-mute">
              {entries.length === 0 ? m('noListening') : m('nothingMatches', { filter })}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <div className={cn(PROC_GRID, 'border-b bg-bg-2/40 px-3 py-1.5 text-[11px] font-semibold text-fg-mute')}>
                {sortHeader('pid', m('pid'))}
                {/* Indent past the in-cell favourite star (w-3 + gap-1.5) so the
                    label sits above the port numbers, not the star. */}
                {sortHeader('port', m('port'), false, 'pl-[18px]')}
                {/* Tooltip của kit thay cho `title` — `title` không mở được bằng bàn phím. */}
                <Tooltip
                  label={m('scopeHelp')}
                  description={<>• local — {m('scope.local')}<br />• LAN — {m('scope.LAN')}<br />• all — {m('scope.all')}</>}
                  side="bottom"
                  width={300}
                >
                  <span tabIndex={0} className="flex cursor-help items-center gap-1 uppercase tracking-wide focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus">
                    {m('scope')}
                    <Info className="h-3 w-3 text-fg-mute/50" />
                  </span>
                </Tooltip>
                {sortHeader('process', m('process'))}
                {sortHeader('mem', m('mem'), true)}
                {sortHeader('uptime', m('uptime'), true)}
              </div>
              <div className="divide-y">
                {sortedGroups.map((g) => (
                  <ProcessRow key={g.key} group={g} isFav={isFav} onToggleFav={toggleFav} />
                ))}
              </div>
            </div>
          )}
          <p className="px-1 text-[11px] text-fg-mute/70">
            {m('ownProcessesNote')}
          </p>
        </div>
      ) : !loading ? (
        <Empty icon={Plug}>{m('portsEmpty')}</Empty>
      ) : null}
    </ViewShell>
  );
}

// ─── IP Lookup view ─────────────────────────────────────────────────────────

function IpLookupView() {
  const m = useMessages(MESSAGES);
  const quickPasteHint = useQuickPasteHint();
  const httpFetch = usePlatformFetch();
  const [ip, setIp] = useSessionState<string>(SESSION.iplookup, 'ip');
  const [info, setInfo] = useSessionState<IpInfo | null>(SESSION.iplookup, 'info');
  const [error, setError] = useSessionState<string>(SESSION.iplookup, 'error');
  const [loading, setLoading] = useState(false);

  useQuickPaste(setIp);

  const run = useCallback(async () => {
    const target = ip.trim();
    if (!target) return;
    setLoading(true); setError(''); setInfo(null);
    try {
      setInfo(await lookupIp(target, undefined, httpFetch));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ip, httpFetch, setInfo, setError]);

  const clear = () => { setIp(''); setInfo(null); setError(''); };

  return (
    <ViewShell
      toolbar={
        <>
          <SearchInput value={ip} onChange={setIp} icon={MapPin} placeholder={m('ipPlaceholder', { hint: quickPasteHint })} onKeyDown={(e) => e.key === 'Enter' && run()} containerClassName="flex-1 min-w-[200px]" className="h-ctl-lg text-sm font-mono" spellCheck={false} autoComplete="off" />
          <Button onClick={run} disabled={loading || !ip.trim()} className="h-ctl-lg gap-1.5">
            {loading ? <Spinner /> : <Search className="h-4 w-4" />}
            {m('lookup')}
          </Button>
        </>
      }
    >
      {error ? <ErrorBox message={error} /> : info ? (
        <div className="space-y-2">
          <MetaBar summary={m('lookupFor', { ip: info.ip })} onClear={clear} />
          <IpCard info={info} />
        </div>
      ) : !loading ? (
        <Empty icon={MapPin}>{m('ipLookupEmpty')}</Empty>
      ) : null}
    </ViewShell>
  );
}

// ─── root ───────────────────────────────────────────────────────────────────

export function NetworkTools() {
  const m = useMessages(MESSAGES);
  const [view, setView] = useSessionState<View>(SESSION.nav, 'view');
  const activeCategory = VIEW_META[view].category;

  // Switch view and remember it as this category's last-visited sub-view.
  const selectView = useCallback((next: View) => {
    LAST_VIEW[VIEW_META[next].category] = next;
    setView(next);
  }, [setView]);

  // Keyboard navigation: ←/→ (or ↑/↓) cycle through views, number keys 1–7 jump
  // straight to one. Ignored while typing in a field so domain/IP entry — and
  // each view's own Enter-to-run — keep working untouched.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const i = VIEW_ORDER.indexOf(view);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        selectView(VIEW_ORDER[(i + 1) % VIEW_ORDER.length]);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        selectView(VIEW_ORDER[(i - 1 + VIEW_ORDER.length) % VIEW_ORDER.length]);
      } else if (/^[1-9]$/.test(e.key)) {
        const n = Number(e.key) - 1;
        if (n < VIEW_ORDER.length) { e.preventDefault(); selectView(VIEW_ORDER[n]); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, selectView]);

  const subViews = VIEWS_BY_CATEGORY[activeCategory];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Two-tier navigation: categories (underline tabs) on top, the active
          category's views (tinted pills) below. Hierarchy comes from the two
          different active treatments, keeping the azure accent restrained. */}
      <div className="shrink-0 border-b border-line">
        {/* Primary: categories — underline tabs */}
        <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar px-2 sm:px-3" role="tablist" aria-label={m('categoryLabel')}>
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = cat.id === activeCategory;
            return (
              <button
                key={cat.id}
                role="tab"
                aria-selected={active}
                onClick={() => selectView(LAST_VIEW[cat.id])}
                className={cn(
                  'relative flex shrink-0 items-center gap-1.5 px-2.5 py-2.5 text-sm font-medium transition-colors',
                  active ? 'text-fg' : 'text-fg-mute hover:text-fg',
                )}
              >
                <Icon className="h-4 w-4" />
                {m(`cat.${cat.id}` as 'cat.dns')}
                <span
                  className={cn(
                    'absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-acc transition-opacity duration-200',
                    active ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </button>
            );
          })}
        </div>
        {/* Secondary: views within the active category — tinted pills */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar px-2 pb-2 pt-1.5 sm:px-3" role="tablist" aria-label={m('viewLabel')}>
          {subViews.map((v) => {
            const meta = VIEW_META[v];
            const Icon = meta.icon;
            const active = v === view;
            return (
              <button
                key={v}
                role="tab"
                aria-selected={active}
                onClick={() => selectView(v)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'bg-acc/10 text-acc'
                    : 'text-fg-mute hover:text-fg hover:bg-fg/[0.06]',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {m(`view.${v}` as 'view.dns')}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active view — content is width-constrained so wide screens stay readable */}
      <div className="flex-1 min-h-0 p-3 sm:p-4">
        <div className="mx-auto h-full w-full max-w-5xl">
          {view === 'dns' && <DnsView />}
          {view === 'propagation' && <PropagationView />}
          {view === 'dnssec' && <DnssecView />}
          {view === 'myip' && <MyIpView />}
          {view === 'iplookup' && <IpLookupView />}
          {view === 'local' && <LocalNetworkView />}
          {view === 'ports' && <PortsView />}
        </div>
      </div>
    </div>
  );
}
