import { useCallback, useEffect, useState } from 'react';
import { Package, Plus, X } from 'lucide-react';
import { useLocale } from '@/contexts/LocaleContext';
import { isTauri } from '@/lib/platform';
import { pendingInstall } from '@/lib/pendingInstall';
import {
  addCustomMarket,
  fetchMarketCatalog,
  getSelectedMarketId,
  listMarkets,
  removeCustomMarket,
  setSelectedMarketId,
  type Market,
  type MarketPlugin,
} from '@/lib/market';
import { currentTargetTriple, listInstalledArtifacts, type InstalledArtifactRecord } from '@/platform';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Callout } from '@/components/ui/callout';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

/**
 * "Chợ tiện ích" — chọn một market (nguồn catalog.json), tự tải danh sách
 * plugin nó cung cấp, và cho cài NGAY từ đây thay vì phải copy URL manifest
 * từ một trang web rồi dán qua tab "Cài từ URL".
 *
 * KHÔNG tự cài gì ở component này: nút Install chỉ xếp URL manifest (+ URL
 * service nếu có) vào `pendingInstall` — đúng hàng đợi mà deep link
 * (`desktop-devtool-app://install`) đã dùng — rồi gọi `onInstallRequested` để
 * component cha chuyển sang tab "Cài từ URL", nơi `SettingsExtensionInstaller`
 * tự kéo hàng đợi và hiện đúng màn hình xem trước/xác nhận đã có sẵn. Không
 * có đường tắt nào bỏ qua bước xác nhận đó — một market tuỳ ý người dùng tự
 * thêm cũng chỉ đáng tin như một URL dán tay, không hơn.
 */

interface SettingsMarketplaceProps {
  /** Gọi sau khi đã xếp xong URL vào hàng đợi — cha chuyển sang tab cài đặt. */
  onInstallRequested: () => void;
}

export function SettingsMarketplace({ onInstallRequested }: SettingsMarketplaceProps) {
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

  const selected = markets.find((m) => m.id === selectedId) ?? markets[0];

  const load = useCallback(async (market: Market) => {
    setLoading(true);
    setError(null);
    setPlugins(null);
    try {
      setPlugins(await fetchMarketCatalog(market.catalogUrl));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) void load(selected);
  }, [selected, load]);

  useEffect(() => {
    if (!isTauri) return;
    // Tuần tự, không Promise.all: hai lời gọi Tauri riêng biệt bắn đồng thời
    // lúc mount từng gây ra một cuộc đua module y hệt đã ghi ở
    // `SettingsExtensionInstaller.test.tsx` (lần `import('@tauri-apps/api/core')`
    // thứ hai có thể không đi qua `vi.mock` trong test). Gọi tuần tự để lời
    // gọi thứ hai luôn thấy module đã nạp xong từ lời gọi đầu.
    void (async () => {
      setInstalled(await listInstalledArtifacts());
      // Máy này hỗ trợ target nào — dùng để cảnh báo một plugin có sidecar
      // không có bản cho nền tảng hiện tại, TÍNH Ở RUST giống hệt
      // SettingsExtensionInstaller (không đoán/tính lại ở webview).
      setTargetTriple(await currentTargetTriple());
    })();
  }, []);

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

  const handleInstall = (plugin: MarketPlugin) => {
    const urls = [plugin.pluginManifestUrl, plugin.serviceManifestUrl].filter((u): u is string => Boolean(u));
    // marketId đi kèm để hai market khác nhau cùng phát hành một plugin
    // trùng id không đè lên nhau (xem installArtifact/installedPluginManifests).
    pendingInstall.enqueue(urls, selected?.id);
    onInstallRequested();
  };

  if (!isTauri) {
    return <Callout tone="info" size="sm">{t('settings.plugins.install.webWarning')}</Callout>;
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium">{t('settings.plugins.tabs.marketplace')}</p>
        <p className="text-[11px] text-fg-mute">{t('settings.plugins.marketplace.description')}</p>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-[11px] font-medium text-fg-mute">{t('settings.plugins.marketplace.marketLabel')}</p>
          <Select value={selected?.id} onValueChange={handleSelectMarket}>
            <SelectTrigger className="h-ctl w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {markets.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                  {!m.builtin ? ` · ${t('settings.plugins.marketplace.custom')}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selected && !selected.builtin && (
          <Button
            variant="outline"
            size="sm"
            title={t('settings.plugins.marketplace.remove')}
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
            placeholder={t('settings.plugins.marketplace.marketNamePlaceholder')}
            className="w-40 text-xs"
          />
          <Input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder={t('settings.plugins.marketplace.marketUrlPlaceholder')}
            className="flex-1 min-w-0 font-mono text-xs"
          />
          <Button size="sm" onClick={handleAddMarket} disabled={!newLabel.trim() || !newUrl.trim()}>
            {t('settings.plugins.marketplace.add')}
          </Button>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 px-1 py-2 text-[11px] text-fg-mute">
          <Spinner size="sm" />
          {t('settings.plugins.marketplace.loading')}
        </div>
      )}

      {error && (
        <Callout tone="error" size="sm">
          {t('settings.plugins.marketplace.error', { error })}
        </Callout>
      )}

      {plugins && plugins.length === 0 && (
        <p className="px-1 py-2 text-[11px] text-fg-mute">{t('settings.plugins.marketplace.empty')}</p>
      )}

      {plugins && plugins.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {plugins.map((p) => (
            <MarketPluginCard
              key={p.id}
              plugin={p}
              // So khớp id + marketId — plugin cùng id cài từ MỘT market khác
              // không được coi là "đã cài" cho thẻ này (hai bản cài độc lập,
              // xem InstalledPluginRecord::market_id phía Rust). Một bản ghi
              // KHÔNG có marketId (cài từ trước tính năng market, hoặc dán
              // tay) vẫn được coi là khớp — không đủ thông tin để biết nó
              // "thuộc" market nào, coi như có thể chính là bản của market
              // này còn hơn hiện "Install" và mời cài chồng thêm một bản nữa.
              installedRecord={installed.find(
                (r) => r.kind === 'plugin' && r.manifest.id === p.id && (r.marketId === selected?.id || r.marketId === undefined),
              )}
              targetTriple={targetTriple}
              onInstall={() => handleInstall(p)}
            />
          ))}
        </div>
      )}
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
  onInstall: () => void;
}) {
  const { t } = useLocale();
  const installedVersion =
    installedRecord?.kind === 'plugin' ? installedRecord.manifest.version : undefined;
  const upToDate = installedVersion === plugin.version;
  const unsupported =
    !!plugin.targets && plugin.targets.length > 0 && !!targetTriple && !plugin.targets.includes(targetTriple);

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <Package className="h-4 w-4 shrink-0 mt-0.5 text-acc" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">
            {plugin.label} <span className="font-mono text-fg-mute/60">{plugin.id}@{plugin.version}</span>
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-mute">{plugin.description}</p>
        </div>
      </div>

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
        <p className="text-[11px] text-warn">{t('settings.plugins.marketplace.unsupportedPlatform')}</p>
      )}

      <Button size="sm" onClick={onInstall} disabled={upToDate || unsupported} className="self-start">
        {upToDate
          ? t('settings.plugins.marketplace.installed')
          : installedVersion
            ? t('settings.plugins.marketplace.updateTo', { version: plugin.version })
            : t('settings.plugins.marketplace.install')}
      </Button>
    </div>
  );
}
