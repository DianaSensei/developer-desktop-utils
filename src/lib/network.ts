// Network helpers — DNS-over-HTTPS (DoH) lookups and public IP info.
//
// All requests are plain `fetch` calls to CORS-enabled public endpoints, so they
// work identically in the web build and inside the Tauri webview (no extra Tauri
// capability needed). Every call here is user-initiated from the Network tool.
//
// Services contacted (shown to the user in the tool UI for transparency):
//   • DNS:   cloudflare-dns.com, dns.google, dns.quad9.net, dns.adguard-dns.com
//   • IP:    ipapi.co, ipwho.is, freeipapi.com (tried in order, fallback chain)

// ─── DNS record types ───────────────────────────────────────────────────────

export const DNS_RECORD_TYPES = [
  'A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'SRV', 'CAA', 'PTR',
] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

// Types queried (and merged) when the user picks "ALL".
export const ALL_RECORD_TYPES: DnsRecordType[] = [
  'A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'SRV', 'CAA',
];

// Numeric RR type → display name (covers DNSSEC types too).
const TYPE_NAMES: Record<number, string> = {
  1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX',
  16: 'TXT', 28: 'AAAA', 33: 'SRV', 43: 'DS', 46: 'RRSIG',
  48: 'DNSKEY', 257: 'CAA',
};

export function typeName(type: number): string {
  return TYPE_NAMES[type] ?? String(type);
}

// DNS RCODE (response status) → label.
const RCODES: Record<number, string> = {
  0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN',
  4: 'NOTIMP', 5: 'REFUSED',
};

export function rcodeName(status: number): string {
  return RCODES[status] ?? `RCODE ${status}`;
}

// ─── DoH providers ──────────────────────────────────────────────────────────

export interface DohProvider {
  id: string;
  label: string;
  build: (name: string, type: string, dnssec: boolean) => string;
}

const q = (s: string) => encodeURIComponent(s.trim());

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Fetch wrapper: in the Tauri desktop app, route through the HTTP plugin so the
// request is made from Rust (no browser `Origin` header, no CORS). Some public
// services (e.g. ipwho.is) reject the WebView's Origin with HTTP 403 — this
// bypasses that. On the web build, fall back to the standard `fetch`.
async function netFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isTauri) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(input, init);
  }
  return fetch(input, init);
}

export const DOH_PROVIDERS: DohProvider[] = [
  {
    id: 'cloudflare',
    label: 'Cloudflare · 1.1.1.1',
    build: (n, t, d) => `https://cloudflare-dns.com/dns-query?name=${q(n)}&type=${t}${d ? '&do=1' : ''}`,
  },
  {
    id: 'google',
    label: 'Google · 8.8.8.8',
    build: (n, t, d) => `https://dns.google/resolve?name=${q(n)}&type=${t}${d ? '&do=1' : ''}`,
  },
  {
    id: 'quad9',
    label: 'Quad9 · 9.9.9.9',
    build: (n, t, d) => `https://dns.quad9.net:5053/dns-query?name=${q(n)}&type=${t}${d ? '&do=1' : ''}`,
  },
  {
    id: 'adguard',
    label: 'AdGuard DNS',
    build: (n, t, d) => `https://dns.adguard-dns.com/resolve?name=${q(n)}&type=${t}${d ? '&do=1' : ''}`,
  },
];

export const DOH_PROVIDER_MAP = new Map(DOH_PROVIDERS.map((p) => [p.id, p]));

// ─── DNS query ──────────────────────────────────────────────────────────────

export interface DnsAnswer {
  name: string;
  type: number;
  typeName: string;
  ttl: number;
  data: string;
}

export interface DnsResult {
  status: number;
  statusName: string;
  ad: boolean; // Authenticated Data — DNSSEC validation passed
  answers: DnsAnswer[];
  authority: DnsAnswer[];
}

interface RawAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

function mapAnswer(a: RawAnswer): DnsAnswer {
  return {
    name: a.name,
    type: a.type,
    typeName: typeName(a.type),
    ttl: a.TTL,
    data: a.data,
  };
}

export async function queryDns(
  name: string,
  type: string,
  provider: DohProvider = DOH_PROVIDERS[0],
  dnssec = false,
  signal?: AbortSignal,
): Promise<DnsResult> {
  const res = await netFetch(provider.build(name, type, dnssec), {
    headers: { Accept: 'application/dns-json' },
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${provider.label}`);
  const json = (await res.json()) as {
    Status: number;
    AD?: boolean;
    Answer?: RawAnswer[];
    Authority?: RawAnswer[];
  };
  return {
    status: json.Status,
    statusName: rcodeName(json.Status),
    ad: !!json.AD,
    answers: (json.Answer ?? []).map(mapAnswer),
    authority: (json.Authority ?? []).map(mapAnswer),
  };
}

// Query every common record type and merge into a single answer list (for "ALL").
export async function queryAllRecords(
  name: string,
  provider: DohProvider = DOH_PROVIDERS[0],
  signal?: AbortSignal,
): Promise<DnsResult> {
  const results = await Promise.allSettled(
    ALL_RECORD_TYPES.map((t) => queryDns(name, t, provider, false, signal)),
  );
  const answers: DnsAnswer[] = [];
  let status = 0;
  let sawSuccess = false;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      sawSuccess = true;
      if (r.value.status === 0) answers.push(...r.value.answers);
      else if (!sawSuccess) status = r.value.status;
    }
  }
  if (!sawSuccess) throw new Error('All record queries failed');
  // Sort by type name for a stable, grouped view.
  answers.sort((a, b) => a.typeName.localeCompare(b.typeName) || a.data.localeCompare(b.data));
  return { status: answers.length ? 0 : status, statusName: rcodeName(answers.length ? 0 : status), ad: false, answers, authority: [] };
}

// ─── DNS propagation (compare resolvers) ────────────────────────────────────

export interface PropagationRow {
  provider: DohProvider;
  ok: boolean;
  records: string[]; // record data strings
  status?: string;
  error?: string;
}

export async function checkPropagation(
  name: string,
  type: string,
  signal?: AbortSignal,
): Promise<PropagationRow[]> {
  const results = await Promise.allSettled(
    DOH_PROVIDERS.map((p) => queryDns(name, type, p, false, signal)),
  );
  return results.map((r, i) => {
    const provider = DOH_PROVIDERS[i];
    if (r.status === 'fulfilled') {
      const records = r.value.answers
        .filter((a) => a.typeName === type)
        .map((a) => a.data)
        .sort();
      return {
        provider,
        ok: r.value.status === 0,
        records,
        status: r.value.statusName,
      };
    }
    return { provider, ok: false, records: [], error: (r.reason as Error)?.message ?? 'Request failed' };
  });
}

// ─── DNSSEC check ───────────────────────────────────────────────────────────

export interface DnssecResult {
  validated: boolean; // AD flag set by resolver
  ds: DnsAnswer[];
  dnskey: DnsAnswer[];
  rrsig: DnsAnswer[];
}

export async function checkDnssec(
  name: string,
  provider: DohProvider = DOH_PROVIDERS[0],
  signal?: AbortSignal,
): Promise<DnssecResult> {
  const [ds, dnskey, a] = await Promise.all([
    queryDns(name, 'DS', provider, true, signal),
    queryDns(name, 'DNSKEY', provider, true, signal),
    queryDns(name, 'A', provider, true, signal),
  ]);
  const rrsig = [...ds.answers, ...dnskey.answers].filter((r) => r.typeName === 'RRSIG');
  return {
    validated: a.ad || dnskey.ad || ds.ad,
    ds: ds.answers.filter((r) => r.typeName === 'DS'),
    dnskey: dnskey.answers.filter((r) => r.typeName === 'DNSKEY'),
    rrsig,
  };
}

// ─── local network (desktop only) ──────────────────────────────────────────

export interface NetInterface {
  name: string;
  ip: string;
  family: string; // "IPv4" | "IPv6"
  internal: boolean; // loopback / link-local — not a routable LAN address
}

export interface LocalNetworkInfo {
  hostname: string;
  primaryIpv4: string | null;
  primaryIpv6: string | null;
  interfaces: NetInterface[];
}

// Reads the machine's own hostname + interfaces via the Rust `local_network_info`
// command. Local-only — nothing leaves the machine. Desktop app only.
export async function getLocalNetworkInfo(): Promise<LocalNetworkInfo> {
  if (!isTauri) throw new Error('Local network info is only available in the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<LocalNetworkInfo>('local_network_info');
}

// ─── Listening ports / processes ──────────────────────────────────────────────

export interface PortEntry {
  protocol: string;            // "TCP" | "UDP"
  family: string;              // "IPv4" | "IPv6"
  localAddress: string;        // bound address (0.0.0.0 / 127.0.0.1 / ::)
  localPort: number;
  state: string;               // TCP state ("LISTEN"); "" for UDP
  pid: number | null;
  processName: string | null;
  memBytes: number | null;     // resident memory of the owning process
  uptimeSecs: number | null;   // how long the process has been running
  project: string | null;      // working-directory name (the project folder)
  framework: string | null;    // detected framework/runtime (Next.js, Express…)
  command: string | null;      // concise command line ("next dev", "node server.js")
}

// Reads the machine's own listening TCP / UDP sockets and the owning process via
// the Rust `list_listening_ports` command. Local-only — nothing leaves the
// machine. Desktop app only.
export async function listListeningPorts(): Promise<PortEntry[]> {
  if (!isTauri) throw new Error('The port viewer is only available in the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<PortEntry[]>('list_listening_ports');
}

// ─── IP info ────────────────────────────────────────────────────────────────

export interface IpInfo {
  ip: string;
  type: string; // IPv4 / IPv6
  city: string;
  region: string;
  country: string;
  countryCode: string;
  flag: string;
  lat: number;
  lon: number;
  timezone: string;
  asn: string;
  org: string;
  isp: string;
}

// Derive a flag emoji from an ISO-3166 alpha-2 country code (works for any provider).
function flagEmoji(cc: string): string {
  const code = cc?.trim().toUpperCase();
  if (!code || code.length !== 2 || !/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// IP geolocation providers, tried in order until one succeeds. Each is free,
// keyless, HTTPS, and CORS-enabled. An empty `ip` means "look up my own IP".
interface IpProvider {
  id: string;
  url: (ip: string) => string;
  parse: (j: Record<string, any>) => IpInfo;
}

const IP_PROVIDERS: IpProvider[] = [
  {
    id: 'ipapi.co',
    url: (ip) => (ip ? `https://ipapi.co/${encodeURIComponent(ip)}/json/` : 'https://ipapi.co/json/'),
    parse: (j) => {
      if (j.error) throw new Error(j.reason || 'Lookup failed');
      const cc = j.country_code ?? '';
      return {
        ip: j.ip, type: j.version ?? '', city: j.city ?? '', region: j.region ?? '',
        country: j.country_name ?? '', countryCode: cc, flag: flagEmoji(cc),
        lat: j.latitude ?? 0, lon: j.longitude ?? 0, timezone: j.timezone ?? '',
        asn: j.asn ?? '', org: j.org ?? '', isp: j.org ?? '',
      };
    },
  },
  {
    id: 'ipwho.is',
    url: (ip) => `https://ipwho.is/${encodeURIComponent(ip)}`,
    parse: (j) => {
      if (j.success === false) throw new Error(j.message || 'Lookup failed');
      const cc = j.country_code ?? '';
      return {
        ip: j.ip, type: j.type ?? '', city: j.city ?? '', region: j.region ?? '',
        country: j.country ?? '', countryCode: cc, flag: j.flag?.emoji ?? flagEmoji(cc),
        lat: j.latitude ?? 0, lon: j.longitude ?? 0, timezone: j.timezone?.id ?? '',
        asn: j.connection?.asn ? `AS${j.connection.asn}` : '', org: j.connection?.org ?? '', isp: j.connection?.isp ?? '',
      };
    },
  },
  {
    id: 'freeipapi.com',
    url: (ip) => (ip ? `https://freeipapi.com/api/json/${encodeURIComponent(ip)}` : 'https://freeipapi.com/api/json'),
    parse: (j) => {
      const cc = j.countryCode ?? '';
      return {
        ip: j.ipAddress, type: j.ipVersion ? `IPv${j.ipVersion}` : '', city: j.cityName ?? '', region: j.regionName ?? '',
        country: j.countryName ?? '', countryCode: cc, flag: flagEmoji(cc),
        lat: j.latitude ?? 0, lon: j.longitude ?? 0, timezone: j.timeZone ?? '',
        asn: '', org: '', isp: '',
      };
    },
  },
];

// ─── Local network info (desktop only) ──────────────────────────────────────

// The machine's own LAN-side view: hostname, primary local addresses, and
// per-interface IPs. Read locally by the Rust backend — nothing is sent out.
// Only available in the Tauri desktop build; the web build can't read the LAN.

export interface NetInterface {
  name: string;
  ip: string;
  family: string; // IPv4 / IPv6
  internal: boolean; // loopback / link-local
}

export interface LocalNetworkInfo {
  hostname: string;
  primaryIpv4: string | null;
  primaryIpv6: string | null;
  interfaces: NetInterface[];
}

export async function localNetworkInfo(): Promise<LocalNetworkInfo | null> {
  if (!isTauri) return null; // web build can't enumerate local interfaces
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<LocalNetworkInfo>('local_network_info');
}

// `ip` empty → returns the caller's own public IP and geo. Falls back across
// providers so a single service being down or rate-limiting (e.g. HTTP 403/429)
// doesn't break the tool.
export async function lookupIp(ip = '', signal?: AbortSignal): Promise<IpInfo> {
  const target = ip.trim();
  let lastError: Error | null = null;
  for (const p of IP_PROVIDERS) {
    try {
      const res = await netFetch(p.url(target), { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const info = p.parse((await res.json()) as Record<string, any>);
      if (!info.ip) throw new Error('Empty response');
      return info;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      lastError = e as Error;
    }
  }
  throw new Error(`All IP services failed${lastError ? ` (${lastError.message})` : ''}`);
}
