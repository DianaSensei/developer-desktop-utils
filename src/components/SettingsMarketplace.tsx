import { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, Plus, X } from 'lucide-react';
import { useLocale } from '@/contexts/LocaleContext';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/platform';
import {
  addCustomMarket,
  fetchMarketCatalog,
  getSelectedMarketId,
  listMarkets,
  removeCustomMarket,
  setSelectedMarketId,
  type Market,
  type MarketPlugin,
  type MarketPluginVariant,
} from '@/lib/market';
import { compareVersions, isPrerelease } from '@/lib/semver';
import { currentTargetTriple, listInstalledArtifacts, type InstalledArtifactRecord } from '@/platform';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Callout } from '@/components/ui/callout';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ExtensionInstallDialog } from '@/components/ExtensionInstallDialog';

/**
 * Extension marketplace: pick a market (a catalog.json source), list its
 * plugins, and install from here. Install opens `ExtensionInstallDialog` on
 * this page; the preview and confirmation are never skipped, since a custom
 * market is only as trustworthy as a pasted URL.
 */

export function SettingsMarketplace() {
  const { t } = useLocale();
  const [markets, setMarkets] = useState<Market[]>(() => listMarkets());
  const [selectedId, setSelectedId] = useState(() => getSelectedMarketId());
  const [plugins, setPlugins] = useState<MarketPlugin[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<InstalledArtifactRecord[]>([]);
  const [targetTriple, setTargetTriple] = useState<string | null>(null);

  const [addingMarket, setAddingMarket] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newUrl, setNewUrl] = useState('');

  // Plugin and channel being previewed for install; `null` when the dialog
  // is closed. The channel picks the URLs: the plugin's own fields (stable)
  // or `plugin.beta`.
  const [installTarget, setInstallTarget] = useState<{ plugin: MarketPlugin; channel: MarketChannel } | null>(null);
  // Memoized per plugin and channel so re-renders while the dialog is open do
  // not create a new array and refetch inside `ExtensionInstallDialog`.
  const installUrls = useMemo(() => {
    const variant = installTarget && channelVariant(installTarget.plugin, installTarget.channel);
    if (!variant) return [];
    return [variant.pluginManifestUrl, variant.serviceManifestUrl].filter((u): u is string => Boolean(u));
  }, [installTarget]);

  const refreshInstalled = useCallback(async () => {
    if (!isTauri) return;
    setInstalled(await listInstalledArtifacts());
  }, []);

  const selected = markets.find((m) => m.id === selectedId) ?? markets[0];

  const load = useCallback(async (market: Market, isStale: () => boolean) => {
    setLoading(true);
    setError(null);
    setPlugins(null);
    try {
      const result = await fetchMarketCatalog(market.catalogUrl);
      // The user may have switched markets while this fetch ran; a late
      // response must not replace the current market's list.
      if (isStale()) return;
      setPlugins(result);
    } catch (e) {
      if (isStale()) return;
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The web build only shows the desktop-only notice; nothing to load.
    if (!isTauri || !selected) return;
    let stale = false;
    void load(selected, () => stale);
    return () => {
      stale = true;
    };
  }, [selected, load]);

  useEffect(() => {
    if (!isTauri) return;
    // Sequential rather than Promise.all: two concurrent first calls raced
    // the module mock of '@tauri-apps/api/core' in tests.
    void (async () => {
      await refreshInstalled();
      // Target triple of this machine (computed by the host), used to warn
      // about plugins without a build for it.
      setTargetTriple(await currentTargetTriple());
    })();
  }, [refreshInstalled]);

  const handleSelectMarket = (id: string) => {
    setSelectedId(id);
    setSelectedMarketId(id);
  };

  const handleAddMarket = () => {
    if (!newLabel.trim() || !newUrl.trim()) return;
    const market = addCustomMarket(newLabel, newUrl);
    setMarkets(listMarkets());
    setNewLabel('');
    setNewUrl('');
    setAddingMarket(false);
    handleSelectMarket(market.id);
  };

  const handleRemoveMarket = (market: Market) => {
    removeCustomMarket(market.id);
    const next = listMarkets();
    setMarkets(next);
    if (selectedId === market.id) handleSelectMarket(next[0].id);
  };

  if (!isTauri) {
    return <Callout tone="info" size="sm">{t('settings.extensions.install.webWarning')}</Callout>;
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium">{t('settings.extensions.tabs.marketplace')}</p>
        <p className="text-[11px] text-fg-mute">{t('settings.extensions.marketplace.description')}</p>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-[11px] font-medium text-fg-mute">{t('settings.extensions.marketplace.marketLabel')}</p>
          <Select value={selected?.id} onValueChange={handleSelectMarket}>
            <SelectTrigger className="h-ctl w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {markets.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                  {!m.builtin ? ` · ${t('settings.extensions.marketplace.custom')}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selected && !selected.builtin && (
          <Button
            variant="outline"
            size="sm"
            title={t('settings.extensions.marketplace.remove')}
            onClick={() => handleRemoveMarket(selected)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setAddingMarket((v) => !v)}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {addingMarket && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={t('settings.extensions.marketplace.marketNamePlaceholder')}
            className="w-40 text-xs"
          />
          <Input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder={t('settings.extensions.marketplace.marketUrlPlaceholder')}
            className="flex-1 min-w-0 font-mono text-xs"
          />
          <Button size="sm" onClick={handleAddMarket} disabled={!newLabel.trim() || !newUrl.trim()}>
            {t('settings.extensions.marketplace.add')}
          </Button>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 px-1 py-2 text-[11px] text-fg-mute">
          <Spinner size="sm" />
          {t('settings.extensions.marketplace.loading')}
        </div>
      )}

      {error && (
        <Callout tone="error" size="sm">
          {t('settings.extensions.marketplace.error', { error })}
        </Callout>
      )}

      {plugins && plugins.length === 0 && (
        <p className="px-1 py-2 text-[11px] text-fg-mute">{t('settings.extensions.marketplace.empty')}</p>
      )}

      {plugins && plugins.length > 0 && (
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
          {plugins.map((p) => (
            <MarketPluginCard
              key={p.id}
              plugin={p}
              // Match on id and market: the same id from another market is a
              // separate install. A record without a market (pasted URL or older
              // install) also counts, rather than inviting a duplicate install.
              installedRecord={installed.find(
                (r) => r.kind === 'plugin' && r.manifest.id === p.id && (r.marketId === selected?.id || r.marketId === undefined),
              )}
              targetTriple={targetTriple}
              onInstall={(channel) => setInstallTarget({ plugin: p, channel })}
            />
          ))}
        </div>
      )}

      <ExtensionInstallDialog
        open={installTarget !== null}
        onOpenChange={(next) => { if (!next) setInstallTarget(null); }}
        urls={installUrls}
        marketId={selected?.id}
        onInstalled={() => void refreshInstalled()}
      />
    </div>
  );
}

function MarketPluginCard({
  plugin,
  installedRecord,
  targetTriple,
  onInstall,
}: {
  plugin: MarketPlugin;
  installedRecord: InstalledArtifactRecord | undefined;
  targetTriple: string | null;
  onInstall: (channel: 'stable' | 'beta') => void;
}) {
  const { t } = useLocale();
  const installedVersion =
    installedRecord?.kind === 'plugin' ? installedRecord.manifest.version : undefined;
  const hasBeta = !!plugin.beta;
  const installedChannel = installedVersion === undefined ? undefined : inferChannel(plugin, installedVersion);
  // The build this card is about: the installed channel's, or stable before
  // anything is installed. A beta that left the catalog falls back to stable.
  const current = channelVariant(plugin, installedChannel ?? 'stable') ?? plugin;
  const upToDate = installedVersion !== undefined && compareVersions(installedVersion, current.version) >= 0;
  const unsupported =
    !!current.targets && current.targets.length > 0 && !!targetTriple && !current.targets.includes(targetTriple);
  const actions = cardActions(plugin, installedChannel, upToDate);

  return (
    <div
      className={cn(
        'flex h-full flex-col gap-2 rounded-lg border p-3 transition-colors',
        upToDate ? 'border-acc/30 bg-acc/5' : 'hover:border-fg-mute/30',
      )}
    >
      <div className="flex items-start gap-2">
        <Package className="h-4 w-4 shrink-0 mt-0.5 text-acc" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{plugin.label}</p>
          <p className="flex items-center gap-1.5 truncate font-mono text-[11px] text-fg-mute/60">
            {plugin.id}@{installedVersion ?? plugin.version}
            {/* The channel label only helps when the plugin has a beta. */}
            {hasBeta && installedChannel && (
              <span className="shrink-0 rounded border px-1 py-0.5 font-sans text-fg-mute/80">
                {t(`settings.extensions.marketplace.${installedChannel === 'beta' ? 'channelBeta' : 'channelStable'}`)}
              </span>
            )}
          </p>
        </div>
      </div>

      <p className="flex-1 text-[11px] leading-relaxed text-fg-mute">{plugin.description}</p>

      {plugin.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {plugin.keywords.slice(0, 6).map((k) => (
            <span key={k} className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-fg-mute">
              {k}
            </span>
          ))}
        </div>
      )}

      {unsupported && (
        <p className="text-[11px] text-warn">{t('settings.extensions.marketplace.unsupportedPlatform')}</p>
      )}

      {/* A warning only: `targets` is advisory (an unofficial market may
          omit a triple that exists), so the user decides. */}
      <div className="flex flex-wrap gap-1.5">
        {actions.map((a) => (
          <Button
            key={a.channel}
            size="sm"
            variant={a.primary ? undefined : 'outline'}
            disabled={a.disabled}
            onClick={() => onInstall(a.channel)}
          >
            {t(`settings.extensions.marketplace.${a.labelKey}`, a.version ? { version: a.version } : undefined)}
          </Button>
        ))}
      </div>
    </div>
  );
}

type MarketChannel = 'stable' | 'beta';

function channelVariant(plugin: MarketPlugin, channel: MarketChannel): MarketPluginVariant | undefined {
  return channel === 'beta' ? plugin.beta : plugin;
}

/** Which channel an installed version came from. The install record does
 *  not store the channel, so it is read off the version: an exact match with
 *  the catalog's stable or beta build wins (stable on a tie), otherwise a
 *  prerelease tag means an older beta. */
function inferChannel(plugin: MarketPlugin, installedVersion: string): MarketChannel {
  if (installedVersion === plugin.version) return 'stable';
  if (installedVersion === plugin.beta?.version) return 'beta';
  return isPrerelease(installedVersion) ? 'beta' : 'stable';
}

interface CardAction {
  channel: MarketChannel;
  labelKey: 'install' | 'installBeta' | 'installed' | 'updateTo' | 'switchToStable' | 'switchToBeta';
  version?: string;
  primary: boolean;
  disabled?: boolean;
}

/** Buttons for a card: install (and install beta) when nothing is
 *  installed; otherwise update-or-installed for the current channel plus a
 *  switch to the other channel when it exists. Switching replaces the
 *  installed build. */
function cardActions(plugin: MarketPlugin, installed: MarketChannel | undefined, upToDate: boolean): CardAction[] {
  if (installed === undefined) {
    const actions: CardAction[] = [{ channel: 'stable', labelKey: 'install', primary: true }];
    if (plugin.beta) actions.push({ channel: 'beta', labelKey: 'installBeta', primary: false });
    return actions;
  }
  // A beta that left the catalog leaves only stable to update to.
  const channel: MarketChannel = installed === 'beta' && plugin.beta ? 'beta' : 'stable';
  const target = channelVariant(plugin, channel) ?? plugin;
  const actions: CardAction[] = [
    upToDate
      ? { channel, labelKey: 'installed', primary: true, disabled: true }
      : { channel, labelKey: 'updateTo', version: target.version, primary: true },
  ];
  if (channel === 'beta') actions.push({ channel: 'stable', labelKey: 'switchToStable', primary: false });
  else if (plugin.beta) actions.push({ channel: 'beta', labelKey: 'switchToBeta', primary: false });
  return actions;
}
