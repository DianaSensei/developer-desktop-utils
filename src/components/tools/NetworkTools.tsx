import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Globe, Search, Loader2, RefreshCw, MapPin, Wifi, Building2,
  Network as NetworkIcon, ShieldCheck, ShieldAlert, CheckCircle2, XCircle,
  AlertCircle, Clock, Server, X, Router, Laptop, Plug, Star, Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { usePersistentState } from '@/hooks/usePersistentState';
import {
  DNS_RECORD_TYPES, DOH_PROVIDERS, DOH_PROVIDER_MAP,
  queryDns, queryAllRecords, checkPropagation, checkDnssec, lookupIp, getLocalNetworkInfo, listListeningPorts,
  type DnsAnswer, type PropagationRow, type DnssecResult, type IpInfo, type LocalNetworkInfo, type PortEntry,
} from '@/lib/network';

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

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ─── session store ──────────────────────────────────────────────────────────
// Inputs + results live in a module-level object, not localStorage. This keeps
// every view's state intact across tab switches AND when you leave the Network
// tool and come back (the module stays loaded for the app's lifetime), while a
// fresh app launch starts clean — matching "keep until cleared or fresh start".

const SESSION = {
  nav: { view: 'dns' as View },
  dns: { domain: '', type: 'A', providerId: 'cloudflare', answers: null as DnsAnswer[] | null, status: '', error: '' },
  prop: { domain: '', type: 'A', rows: null as PropagationRow[] | null, error: '' },
  dnssec: { domain: '', result: null as DnssecResult | null, error: '' },
  myip: { info: null as IpInfo | null, error: '' },
  local: { info: null as LocalNetworkInfo | null, error: '' },
  ports: { entries: null as PortEntry[] | null, error: '', filter: '', favOnly: false },
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
      className="h-6 w-6 shrink-0 text-muted-foreground/60 hover:text-foreground"
      iconClassName="h-3.5 w-3.5"
    />
  );
}

// Shared label badge used across result lists (DNS record type, interface
// family, port protocol/status) so every result surface reads the same way.
function Pill({ children, tone = 'primary', className }: {
  children: React.ReactNode;
  tone?: 'primary' | 'muted' | 'amber';
  className?: string;
}) {
  const tones = {
    primary: 'bg-primary/10 text-primary',
    muted: 'bg-muted text-muted-foreground',
    amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  };
  return (
    <span className={cn('w-fit rounded px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold', tones[tone], className)}>
      {children}
    </span>
  );
}

// Bar shown above results: a short summary on the left, a Clear action on the right.
function MetaBar({ summary, onClear }: { summary: React.ReactNode; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-muted-foreground">{summary}</span>
      <button
        type="button"
        onClick={onClear}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <X className="h-3 w-3" /> Clear
      </button>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
      <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
      <span className="break-words">{message}</span>
    </div>
  );
}

function Empty({ icon: Icon = Globe, children }: { icon?: typeof Globe; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border bg-card">
        <Icon className="h-6 w-6 text-muted-foreground/40" />
      </div>
      <p className="max-w-xs text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

// Consistent toolbar input with a leading icon.
function SearchInput({
  value, onChange, onEnter, placeholder, icon: Icon = Globe, mono,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  placeholder: string;
  icon?: typeof Globe;
  mono?: boolean;
}) {
  return (
    <div className="relative flex-1 min-w-[200px]">
      <Icon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter()}
        placeholder={placeholder}
        className={cn('h-9 pl-9 text-sm', mono && 'font-mono')}
        spellCheck={false}
        autoComplete="off"
      />
    </div>
  );
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

// Small uppercase section divider with an optional trailing count.
function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-0.5 pt-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{children}</span>
      {count != null && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{count}</span>}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

// Self-contained stat card — each is its own bordered box, so an odd number of
// items just leaves clean background (no hollow grid cells).
function StatCard({ icon: Icon, label, value }: { icon: typeof Globe; label: string; value: string }) {
  return (
    <div className="group flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="font-mono text-sm break-all leading-snug">{value}</p>
      </div>
      <CopyBtn value={value} />
    </div>
  );
}

function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

// ─── DNS lookup view ────────────────────────────────────────────────────────

function DnsView() {
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
      const res = type === 'ALL' ? await queryAllRecords(name, provider) : await queryDns(name, type, provider);
      setStatus(res.statusName);
      setAnswers(res.answers);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [domain, type, providerId, setAnswers, setError, setStatus]);

  const clear = () => { setDomain(''); setAnswers(null); setStatus(''); setError(''); };

  return (
    <ViewShell
      toolbar={
        <>
          <SearchInput value={domain} onChange={setDomain} onEnter={run} placeholder={`example.com — ${quickPasteHint}`} />
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-9 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DNS_RECORD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              <SelectItem value="ALL">ALL</SelectItem>
            </SelectContent>
          </Select>
          <Select value={providerId} onValueChange={setProviderId}>
            <SelectTrigger className="h-9 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DOH_PROVIDERS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={run} disabled={loading || !domain.trim()} className="h-9 gap-1.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Lookup
          </Button>
        </>
      }
    >
      {error ? <ErrorBox message={error} /> : answers ? (
        <div className="space-y-2">
          <MetaBar
            summary={`${answers.length} record${answers.length === 1 ? '' : 's'}${status && status !== 'NOERROR' ? ` · ${status}` : ''}`}
            onClear={clear}
          />
          {answers.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No {type} records found{status && status !== 'NOERROR' ? ` · ${status}` : ''}.
            </div>
          ) : (
            <div className="grid gap-1.5 lg:grid-cols-2">
              {answers.map((a, i) => (
                <div key={i} className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
                  <Pill className="shrink-0 w-12">{a.typeName}</Pill>
                  <span className="flex-1 font-mono text-xs break-all">{a.data}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums" title="TTL (seconds)">{a.ttl}s</span>
                  <CopyBtn value={a.data} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : !loading ? (
        <Empty>Enter a domain and pick a record type to look up its DNS records.</Empty>
      ) : null}
    </ViewShell>
  );
}

// ─── propagation view ───────────────────────────────────────────────────────

function PropagationView() {
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
      setRows(await checkPropagation(name, type));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [domain, type, setRows, setError]);

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
          <SearchInput value={domain} onChange={setDomain} onEnter={run} placeholder={`example.com — ${quickPasteHint}`} />
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-9 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DNS_RECORD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={run} disabled={loading || !domain.trim()} className="h-9 gap-1.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Check
          </Button>
        </>
      }
    >
      {error ? <ErrorBox message={error} /> : rows ? (
        <div className="space-y-2">
          <MetaBar summary={`${type} across ${rows.length} resolvers`} onClear={clear} />
          {consistent !== null && (
            <div className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium',
              consistent
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
            )}>
              {consistent ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              {consistent ? 'Fully propagated — all resolvers agree.' : 'Not yet consistent — resolvers returned different answers.'}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.provider.id} className="rounded-lg border bg-card px-3 py-2.5">
                <div className="flex items-center gap-2">
                  {r.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
                  <span className="text-sm font-medium">{r.provider.label}</span>
                  {r.status && r.status !== 'NOERROR' && <span className="ml-auto text-[11px] text-muted-foreground">{r.status}</span>}
                </div>
                {r.error ? (
                  <p className="mt-1.5 pl-6 text-xs text-destructive">{r.error}</p>
                ) : r.records.length ? (
                  <div className="mt-1.5 pl-6 space-y-1">
                    {r.records.map((rec, i) => <div key={i} className="font-mono text-xs break-all text-muted-foreground">{rec}</div>)}
                  </div>
                ) : (
                  <p className="mt-1.5 pl-6 text-xs text-muted-foreground">No {type} records</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : !loading ? (
        <Empty icon={NetworkIcon}>Compare a record across Cloudflare, Google, Quad9, and AdGuard resolvers.</Empty>
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
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{records.length}</span>
      </div>
      <div className="space-y-1">
        {records.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="flex-1 font-mono text-[11px] break-all text-muted-foreground">{r.data}</span>
            <CopyBtn value={r.data} />
          </div>
        ))}
      </div>
    </div>
  );
}

function DnssecView() {
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
      setResult(await checkDnssec(name));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [domain, setResult, setError]);

  const clear = () => { setDomain(''); setResult(null); setError(''); };
  const hasData = result && (result.ds.length || result.dnskey.length || result.rrsig.length);

  return (
    <ViewShell
      toolbar={
        <>
          <SearchInput value={domain} onChange={setDomain} onEnter={run} placeholder={`example.com — ${quickPasteHint}`} />
          <Button onClick={run} disabled={loading || !domain.trim()} className="h-9 gap-1.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Check
          </Button>
        </>
      }
    >
      {error ? <ErrorBox message={error} /> : result ? (
        <div className="space-y-2">
          <MetaBar summary="DNSSEC chain" onClear={clear} />
          <div className={cn(
            'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm font-medium',
            result.validated
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
          )}>
            {result.validated ? <ShieldCheck className="h-5 w-5 shrink-0" /> : <ShieldAlert className="h-5 w-5 shrink-0" />}
            {result.validated
              ? 'DNSSEC validated — the resolver authenticated this domain (AD flag set).'
              : 'No DNSSEC validation — domain is unsigned or the chain of trust is incomplete.'}
          </div>
          {hasData ? (
            <div className="space-y-2">
              <div className="grid gap-2 lg:grid-cols-2">
                <DnssecSection title="DS records" records={result.ds} />
                <DnssecSection title="DNSKEY records" records={result.dnskey} />
              </div>
              <DnssecSection title="RRSIG signatures" records={result.rrsig} />
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No DS, DNSKEY, or RRSIG records published for this domain.
            </div>
          )}
        </div>
      ) : !loading ? (
        <Empty icon={ShieldCheck}>Check whether a domain publishes DNSSEC records and validates.</Empty>
      ) : null}
    </ViewShell>
  );
}

// ─── IP info card (shared by My IP + IP Lookup) ─────────────────────────────

function IpCard({ info }: { info: IpInfo }) {
  const fields: { label: string; value: string; icon: typeof Globe }[] = [
    { label: 'IP address', value: `${info.ip}${info.type ? `  (${info.type})` : ''}`, icon: NetworkIcon },
    { label: 'Location', value: [info.city, info.region, `${info.country} ${info.flag}`].filter((s) => s && s.trim()).join(', '), icon: MapPin },
    { label: 'Coordinates', value: info.lat || info.lon ? `${info.lat}, ${info.lon}` : '', icon: Globe },
    { label: 'Timezone', value: info.timezone, icon: Clock },
    { label: 'ISP', value: info.isp, icon: Wifi },
    { label: 'Organization', value: info.org, icon: Building2 },
    { label: 'ASN', value: info.asn, icon: Server },
  ].filter((r) => r.value);

  return (
    <StatGrid>
      {fields.map((f) => <StatCard key={f.label} icon={f.icon} label={f.label} value={f.value} />)}
    </StatGrid>
  );
}

// ─── My IP view ─────────────────────────────────────────────────────────────

function MyIpView() {
  const [info, setInfo] = useSessionState<IpInfo | null>(SESSION.myip, 'info');
  const [error, setError] = useSessionState<string>(SESSION.myip, 'error');
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true); setError(''); setInfo(null);
    try {
      setInfo(await lookupIp());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [setInfo, setError]);

  const clear = () => { setInfo(null); setError(''); };

  return (
    <ViewShell
      toolbar={
        <>
          <Button onClick={run} disabled={loading} className="h-9 gap-1.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {info ? 'Refresh' : 'Detect my public IP'}
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
          <MetaBar summary="Your public IP" onClear={clear} />
          <IpCard info={info} />
        </div>
      ) : !loading ? (
        <Empty icon={NetworkIcon}>Detect your current public IP address and its geolocation.</Empty>
      ) : null}
    </ViewShell>
  );
}

// ─── Local Network view (desktop only) ──────────────────────────────────────

function LocalNetworkView() {
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
    { label: 'Hostname', value: info.hostname, icon: Laptop },
    { label: 'Primary IPv4', value: info.primaryIpv4 ?? '', icon: NetworkIcon },
    { label: 'Primary IPv6', value: info.primaryIpv6 ?? '', icon: NetworkIcon },
  ].filter((f) => f.value) : [];

  return (
    <ViewShell
      toolbar={
        <>
          <Button onClick={run} disabled={loading || !IS_TAURI} className="h-9 gap-1.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {info ? 'Refresh' : 'Detect local network'}
          </Button>
          {info?.hostname && (
            <span className="font-mono text-lg font-semibold">{info.hostname}</span>
          )}
        </>
      }
    >
      {!IS_TAURI ? (
        <Empty icon={Router}>Local network info reads your machine's interfaces and is only available in the desktop app.</Empty>
      ) : error ? <ErrorBox message={error} /> : info ? (
        <div className="space-y-2.5">
          <MetaBar summary="Read locally — nothing leaves this machine" onClear={clear} />
          <StatGrid>
            {summary.map((f) => <StatCard key={f.label} icon={f.icon} label={f.label} value={f.value} />)}
          </StatGrid>

          {info.interfaces.length > 0 && (
            <>
              <SectionLabel count={info.interfaces.length}>Interfaces</SectionLabel>
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
                      <p className="text-[11px] text-muted-foreground">
                        {iface.name}{iface.internal && ' · internal'}
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
        <Empty icon={Router}>Show this machine's hostname, LAN addresses, and network interfaces.</Empty>
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

function PortsView() {
  const [entries, setEntries] = useSessionState<PortEntry[] | null>(SESSION.ports, 'entries');
  const [error, setError] = useSessionState<string>(SESSION.ports, 'error');
  const [filter, setFilter] = useSessionState<string>(SESSION.ports, 'filter');
  const [favOnly, setFavOnly] = useSessionState<boolean>(SESSION.ports, 'favOnly');
  // Favourites are a user preference, so they persist across app restarts
  // (unlike scan results, which live in the in-memory session store).
  const [favorites, setFavorites] = usePersistentState<number[]>('devtool:network:favoritePorts', []);
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
    (e.pid != null && String(e.pid).includes(q));

  const scanned = (entries ?? []).filter(matchesFilter);

  // Build the rows to render. In "favourites only" mode we list every favourite
  // port (sorted) with its live sockets, or a synthetic "free" row when nothing
  // is bound to it. Otherwise we show all sockets with favourites pinned on top.
  let rows: PortRow[];
  if (favOnly) {
    const byPort = new Map<number, PortEntry[]>();
    for (const e of scanned) {
      const list = byPort.get(e.localPort);
      if (list) list.push(e); else byPort.set(e.localPort, [e]);
    }
    rows = favorites
      .filter((port) => !q || String(port).includes(q))
      .flatMap((port): PortRow[] => {
        const matches = byPort.get(port);
        return matches?.length ? matches.map((entry) => ({ kind: 'socket', entry })) : [{ kind: 'free', port }];
      });
  } else {
    rows = [...scanned]
      .sort((a, b) => Number(isFav(b.localPort)) - Number(isFav(a.localPort)) || a.localPort - b.localPort)
      .map((entry) => ({ kind: 'socket', entry }));
  }

  const favBtnActive = favOnly && 'border-primary/40 bg-primary/10 text-primary';

  return (
    <ViewShell
      toolbar={
        <>
          <Button onClick={run} disabled={loading || !IS_TAURI} className="h-9 gap-1.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {entries ? 'Refresh' : 'Scan ports'}
          </Button>
          <Button
            variant="outline"
            onClick={() => setFavOnly((v) => !v)}
            className={cn('h-9 gap-1.5', favBtnActive)}
            title="Show only your favourite ports"
          >
            <Star className={cn('h-4 w-4', favOnly && 'fill-current')} />
            Favourites{favorites.length > 0 ? ` (${favorites.length})` : ''}
          </Button>
          {favOnly ? (
            <div className="relative flex-1 min-w-[160px]">
              <Plus className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
              <Input
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addFavorite()}
                placeholder="Add a port, e.g. 3000"
                inputMode="numeric"
                className="h-9 pl-9 text-sm font-mono"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          ) : entries && entries.length > 0 ? (
            <SearchInput value={filter} onChange={setFilter} onEnter={() => {}} icon={Search} placeholder="Filter by port, process, PID, or address…" />
          ) : null}
        </>
      }
    >
      {!IS_TAURI ? (
        <Empty icon={Plug}>The port viewer reads your machine's listening sockets and is only available in the desktop app.</Empty>
      ) : error ? <ErrorBox message={error} /> : favOnly && favorites.length === 0 ? (
        <Empty icon={Star}>No favourite ports yet. Add one above, or star a port in the full list to track whether it's free or in use.</Empty>
      ) : entries ? (
        <div className="space-y-2.5">
          <MetaBar
            summary={
              favOnly
                ? `${favorites.length} favourite ${favorites.length === 1 ? 'port' : 'ports'} · read locally`
                : `${scanned.length}${filter.trim() ? ` of ${entries.length}` : ''} listening ${entries.length === 1 ? 'socket' : 'sockets'} · read locally`
            }
            onClear={clear}
          />
          {rows.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              {entries.length === 0 ? 'No listening ports found.' : `No ports match "${filter}"`}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <div className={cn(PORTS_GRID, 'border-b bg-muted/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground')}>
                <span className="sr-only">Favourite</span><span>Port</span><span>Proto</span><span>Process</span><span>PID</span><span>Address</span>
              </div>
              <div className="divide-y">
                {rows.map((row, i) => {
                  const port = row.kind === 'socket' ? row.entry.localPort : row.port;
                  const fav = isFav(port);
                  return (
                    <div
                      key={row.kind === 'socket'
                        ? `${row.entry.protocol}-${row.entry.family}-${row.entry.localAddress}-${row.entry.localPort}-${i}`
                        : `free-${port}`}
                      className={cn(PORTS_GRID, 'px-3 py-1.5 text-xs', row.kind === 'free' && 'opacity-60')}
                    >
                      <button
                        type="button"
                        onClick={() => toggleFav(port)}
                        className={cn(
                          'flex h-6 w-6 items-center justify-center rounded transition-colors',
                          fav ? 'text-amber-500 hover:text-amber-600' : 'text-muted-foreground/40 hover:text-muted-foreground',
                        )}
                        title={fav ? `Remove port ${port} from favourites` : `Add port ${port} to favourites`}
                        aria-label={fav ? `Remove port ${port} from favourites` : `Add port ${port} to favourites`}
                        aria-pressed={fav}
                      >
                        <Star className={cn('h-3.5 w-3.5', fav && 'fill-current')} />
                      </button>
                      <span className="font-mono font-semibold tabular-nums">{port}</span>
                      {row.kind === 'socket' ? (
                        <>
                          <Pill tone={row.entry.protocol === 'UDP' ? 'amber' : 'primary'}>{row.entry.protocol}</Pill>
                          <span className="truncate" title={row.entry.processName ?? undefined}>{row.entry.processName ?? '—'}</span>
                          <span className="font-mono tabular-nums text-muted-foreground">{row.entry.pid ?? '—'}</span>
                          <span className="truncate font-mono text-muted-foreground" title={row.entry.localAddress}>{row.entry.localAddress}</span>
                        </>
                      ) : (
                        <>
                          <Pill tone="muted">FREE</Pill>
                          <span className="text-muted-foreground italic">not listening</span>
                          <span className="text-muted-foreground">—</span>
                          <span className="text-muted-foreground">—</span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <p className="px-1 text-[11px] text-muted-foreground/70">
            Shows your own user's sockets. System or other-user processes may need elevated privileges to appear — an OS restriction, not a tool limit.
          </p>
        </div>
      ) : !loading ? (
        <Empty icon={Plug}>List the TCP/UDP ports this machine is listening on and the process that owns each one. Star the ports you care about to track them.</Empty>
      ) : null}
    </ViewShell>
  );
}

// ─── IP Lookup view ─────────────────────────────────────────────────────────

function IpLookupView() {
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
      setInfo(await lookupIp(target));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ip, setInfo, setError]);

  const clear = () => { setIp(''); setInfo(null); setError(''); };

  return (
    <ViewShell
      toolbar={
        <>
          <SearchInput value={ip} onChange={setIp} onEnter={run} icon={MapPin} mono placeholder={`8.8.8.8 or 2606:4700:4700::1111 — ${quickPasteHint}`} />
          <Button onClick={run} disabled={loading || !ip.trim()} className="h-9 gap-1.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Lookup
          </Button>
        </>
      }
    >
      {error ? <ErrorBox message={error} /> : info ? (
        <div className="space-y-2">
          <MetaBar summary={`Lookup for ${info.ip}`} onClear={clear} />
          <IpCard info={info} />
        </div>
      ) : !loading ? (
        <Empty icon={MapPin}>Enter any IPv4 or IPv6 address to see its geolocation, ISP, and ASN.</Empty>
      ) : null}
    </ViewShell>
  );
}

// ─── root ───────────────────────────────────────────────────────────────────

export function NetworkTools() {
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
      <div className="shrink-0 border-b border-border">
        {/* Primary: categories — underline tabs */}
        <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar px-2 sm:px-3" role="tablist" aria-label="Network category">
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
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {cat.label}
                <span
                  className={cn(
                    'absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary transition-opacity duration-200',
                    active ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </button>
            );
          })}
        </div>
        {/* Secondary: views within the active category — tinted pills */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar px-2 pb-2 pt-1.5 sm:px-3" role="tablist" aria-label="Network view">
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
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06]',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {meta.label}
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
