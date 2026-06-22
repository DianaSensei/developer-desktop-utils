import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Globe, Search, Loader2, Copy, RefreshCw, MapPin, Wifi, Building2,
  Network as NetworkIcon, ShieldCheck, ShieldAlert, CheckCircle2, XCircle,
  AlertCircle, Clock, Server, X, Router, Laptop,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { copyToClipboard } from '@/lib/clipboard';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import {
  DNS_RECORD_TYPES, DOH_PROVIDERS, DOH_PROVIDER_MAP,
  queryDns, queryAllRecords, checkPropagation, checkDnssec, lookupIp, getLocalNetworkInfo,
  type DnsAnswer, type PropagationRow, type DnssecResult, type IpInfo, type LocalNetworkInfo,
} from '@/lib/network';

type View = 'dns' | 'propagation' | 'dnssec' | 'myip' | 'local' | 'iplookup';

const VIEWS: { id: View; label: string }[] = [
  { id: 'dns', label: 'DNS Lookup' },
  { id: 'propagation', label: 'Propagation' },
  { id: 'dnssec', label: 'DNSSEC' },
  { id: 'myip', label: "What's My IP" },
  { id: 'local', label: 'Local Network' },
  { id: 'iplookup', label: 'IP Lookup' },
];

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
  iplookup: { ip: '', info: null as IpInfo | null, error: '' },
};

function useSessionState<T>(slot: Record<string, unknown>, key: string): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => slot[key] as T);
  useEffect(() => { slot[key] = value; }, [slot, key, value]);
  return [value, setValue];
}

// ─── shared bits ────────────────────────────────────────────────────────────

function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => { await copyToClipboard(value); setDone(true); setTimeout(() => setDone(false), 1200); }}
      className="shrink-0 text-muted-foreground/60 hover:text-foreground transition-colors"
      title="Copy"
    >
      {done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
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
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border bg-card">
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
                  <span className="shrink-0 w-12 rounded bg-primary/10 px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold text-primary">{a.typeName}</span>
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
                    <span className="shrink-0 w-12 rounded bg-primary/10 px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold text-primary">
                      {iface.family === 'IPv6' ? 'v6' : 'v4'}
                    </span>
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* View switcher */}
      <div className="shrink-0 flex items-center gap-2 overflow-x-auto no-scrollbar border-b border-border px-3 py-2.5 sm:px-4">
        <div className="inline-flex h-8 rounded-lg border border-border bg-muted/50 p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={cn(
                'rounded-md px-3 text-xs font-medium transition-all duration-150 whitespace-nowrap',
                view === v.id ? 'bg-card text-foreground shadow-sm-premium' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="ml-auto hidden shrink-0 lg:block text-[11px] text-muted-foreground">
          via Cloudflare · Google · Quad9 · AdGuard · ipapi.co
        </span>
      </div>

      {/* Active view — content is width-constrained so wide screens stay readable */}
      <div className="flex-1 min-h-0 p-3 sm:p-4">
        <div className="mx-auto h-full w-full max-w-5xl">
          {view === 'dns' && <DnsView />}
          {view === 'propagation' && <PropagationView />}
          {view === 'dnssec' && <DnssecView />}
          {view === 'myip' && <MyIpView />}
          {view === 'local' && <LocalNetworkView />}
          {view === 'iplookup' && <IpLookupView />}
        </div>
      </div>
    </div>
  );
}
