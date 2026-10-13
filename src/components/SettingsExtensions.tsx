import { useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { SettingsExtensionInstaller } from '@/components/SettingsExtensionInstaller';
import { SettingsInstalledExtensions } from '@/components/SettingsInstalledExtensions';
import { SettingsMarketplace } from '@/components/SettingsMarketplace';
import { ExtensionInstallDialog } from '@/components/ExtensionInstallDialog';
import { Tabs } from '@/components/ui/tabs';
import { pendingInstall, type PendingInstallItem } from '@/lib/pendingInstall';

/**
 * Settings → Extensions: install plugins and sidecars that are not built in
 * (from the marketplace or a pasted manifest URL) and manage installed ones.
 * Built-in tools and their permissions are under Settings → Plugins.
 *
 * Installed extensions have their own tab. Install requests from outside
 * (deep links, see deepLink.ts) open `ExtensionInstallDialog` over
 * whichever tab is showing.
 */

export function SettingsExtensions() {
  const { t } = useLocale();
  const [tab, setTab] = useState<'marketplace' | 'installUrl' | 'installed'>('marketplace');
  const [pendingBatch, setPendingBatch] = useState<PendingInstallItem[] | null>(null);

  useEffect(() => {
    const drain = () => {
      const items = pendingInstall.dequeueAll();
      if (items.length > 0) setPendingBatch(items);
    };
    drain(); // bắt lô đã xếp sẵn TRƯỚC khi trang này mount (deep link mở app nguội)
    return pendingInstall.subscribe(drain);
  }, []);

  // Memoized per batch, like `installUrls` in SettingsMarketplace.tsx.
  const pendingUrls = useMemo(() => pendingBatch?.map((item) => item.url) ?? [], [pendingBatch]);

  return (
    <section className="space-y-3">
      <p className="text-[11px] text-fg-mute -mt-1">{t('settings.extensions.description')}</p>

      <div className="rounded-lg border">
        <Tabs
          tabs={[
            { id: 'marketplace', label: t('settings.extensions.tabs.marketplace') },
            { id: 'installUrl', label: t('settings.extensions.tabs.installUrl') },
            { id: 'installed', label: t('settings.extensions.tabs.installed') },
          ]}
          active={tab}
          onSelect={(id) => setTab(id as 'marketplace' | 'installUrl' | 'installed')}
        />
        <div className="p-3">
          {tab === 'marketplace' ? (
            <SettingsMarketplace />
          ) : tab === 'installUrl' ? (
            <SettingsExtensionInstaller />
          ) : (
            <SettingsInstalledExtensions />
          )}
        </div>
      </div>

      {pendingBatch && (
        <ExtensionInstallDialog
          open
          onOpenChange={(next) => { if (!next) setPendingBatch(null); }}
          urls={pendingUrls}
          marketId={pendingBatch[0]?.marketId}
        />
      )}
    </section>
  );
}
