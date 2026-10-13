// A market is a catalog.json listing installable plugins, unlike the
// single-URL install field. A market installs nothing itself: the chosen
// manifest URL goes through the usual preview and confirmation.
//
// The official market (developer-desktop-miniapp's catalog.json) is built
// in; users can add others (internal, forks) in the same `MarketCatalog`
// format.

import { isTauri } from '@/lib/platform';
import { storageGet, storageSet } from '@/lib/persistentStore';

export interface Market {
  id: string;
  label: string;
  catalogUrl: string;
  /** `true` for built-in markets, which cannot be removed. */
  builtin: boolean;
}

/** One installable build: the stable fields flattened on `MarketPlugin`, or
 *  its optional `beta`. Both carry what an install needs (version, plugin
 *  manifest URL, optional service manifest URL). */
export interface MarketPluginVariant {
  version: string;
  pluginManifestUrl: string;
  serviceManifestUrl?: string;
  /** Target triples the sidecar supports, if known. Used for a warning,
   *  never to block an install. */
  targets?: string[];
}

export interface MarketPlugin extends MarketPluginVariant {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  /** Beta build of the same plugin (same id, different version and URLs),
   *  if the author publishes one. Only one build of a plugin is installed at
   *  a time: installing the other channel replaces the current build (see
   *  the switch button in `SettingsMarketplace.tsx`). Missing means no beta,
   *  not a malformed entry. */
  beta?: MarketPluginVariant;
}

const BUILTIN_MARKETS: Market[] = [
  {
    id: 'official',
    label: 'DevTool Official',
    catalogUrl: 'https://raw.githubusercontent.com/DianaSensei/developer-desktop-miniapp/main/catalog.json',
    builtin: true,
  },
];

const CUSTOM_MARKETS_KEY = 'devtool-markets-custom';
const SELECTED_MARKET_KEY = 'devtool-market-selected';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function loadCustomMarkets(): Market[] {
  const raw = storageGet(CUSTOM_MARKETS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is Market =>
        !!m &&
        typeof m === 'object' &&
        isNonEmptyString((m as Market).id) &&
        isNonEmptyString((m as Market).label) &&
        isNonEmptyString((m as Market).catalogUrl),
    ).map((m) => ({ ...m, builtin: false }));
  } catch {
    return [];
  }
}

function saveCustomMarkets(markets: Market[]): void {
  storageSet(CUSTOM_MARKETS_KEY, JSON.stringify(markets));
}

/** Built-in markets first, then custom ones in the order added. */
export function listMarkets(): Market[] {
  return [...BUILTIN_MARKETS, ...loadCustomMarkets()];
}

// `Date.now()` alone collides within a millisecond, so add a random
// suffix (Web Crypto, which static analyzers accept, unlike Math.random).
function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(36)).join('').slice(0, 6);
}

// Market ids are kebab-case because they become the `group` of installed
// plugins, appearing in routes (`/installed/<group>/<id>`) and on-disk
// paths (`by-market/<market_id>/`).
export function addCustomMarket(label: string, catalogUrl: string): Market {
  const market: Market = {
    id: `custom-${Date.now()}-${randomSuffix()}`,
    label: label.trim(),
    catalogUrl: catalogUrl.trim(),
    builtin: false,
  };
  saveCustomMarkets([...loadCustomMarkets(), market]);
  return market;
}

export function removeCustomMarket(id: string): void {
  saveCustomMarkets(loadCustomMarkets().filter((m) => m.id !== id));
}

/** Selected market, falling back to the first built-in one when nothing is
 *  selected or the saved market no longer exists. */
export function getSelectedMarketId(): string {
  const saved = storageGet(SELECTED_MARKET_KEY);
  if (saved && listMarkets().some((m) => m.id === saved)) return saved;
  return BUILTIN_MARKETS[0].id;
}

export function setSelectedMarketId(id: string): void {
  storageSet(SELECTED_MARKET_KEY, id);
}

// Like network.ts: the HTTP plugin in the desktop app avoids CORS/Origin
// problems; the web build uses `fetch`. This is shell code, so the plugin
// SDK checks do not apply.
async function marketFetch(url: string): Promise<Response> {
  if (isTauri) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url);
  }
  return fetch(url);
}

/** Parses the installable part of an entry, shared by the stable fields and
 *  `beta` (which inherits id, label, description and keywords from its
 *  parent). */
function toMarketPluginVariant(raw: unknown): MarketPluginVariant | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isNonEmptyString(r.version) || !isNonEmptyString(r.pluginManifestUrl)) return null;
  return {
    version: r.version,
    pluginManifestUrl: r.pluginManifestUrl,
    serviceManifestUrl: isNonEmptyString(r.serviceManifestUrl) ? r.serviceManifestUrl : undefined,
    targets: Array.isArray(r.targets) ? r.targets.filter(isNonEmptyString) : undefined,
  };
}

function toMarketPlugin(raw: unknown): MarketPlugin | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const stable = toMarketPluginVariant(r);
  if (!stable || !isNonEmptyString(r.id) || !isNonEmptyString(r.label) || !isNonEmptyString(r.description)) {
    return null;
  }
  return {
    ...stable,
    id: r.id,
    label: r.label,
    description: r.description,
    keywords: Array.isArray(r.keywords) ? r.keywords.filter(isNonEmptyString) : [],
    // A malformed `beta` drops only the beta, not the whole plugin.
    beta: toMarketPluginVariant(r.beta) ?? undefined,
  };
}

/** Fetches and validates a catalog.json. Throws on HTTP or format errors;
 *  individual malformed entries are skipped. */
export async function fetchMarketCatalog(url: string): Promise<MarketPlugin[]> {
  const res = await marketFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: unknown = await res.json();
  const plugins = data && typeof data === 'object' ? (data as { plugins?: unknown }).plugins : undefined;
  if (!Array.isArray(plugins)) {
    throw new Error('Catalog is missing a "plugins" array.');
  }
  return plugins.map(toMarketPlugin).filter((p): p is MarketPlugin => p !== null);
}
