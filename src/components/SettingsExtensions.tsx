import { useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { SettingsExtensionInstaller } from '@/components/SettingsExtensionInstaller';
import { SettingsMarketplace } from '@/components/SettingsMarketplace';
import { ExtensionInstallDialog } from '@/components/ExtensionInstallDialog';
import { Tabs } from '@/components/ui/tabs';
import { pendingInstall, type PendingInstallItem } from '@/lib/pendingInstall';

/**
 * Settings → Extensions: cài THÊM plugin/sidecar KHÔNG có sẵn trong bản
 * biên dịch của app, qua Chợ tiện ích hoặc dán URL manifest tay. Tách khỏi
 * Settings → Plugins (danh sách tool biên dịch sẵn + nhật ký) — hai câu hỏi
 * khác nhau: "app này có những plugin nào sẵn, quyền gì" so với "tôi muốn
 * cài thêm cái gì đó KHÔNG có sẵn".
 *
 * Một lượt cài tới từ BÊN NGOÀI trang này (deep link
 * `desktop-devtool-app://install`, xử lý ở `deepLink.ts`) hiện `ExtensionInstallDialog`
 * NGAY TẠI ĐÂY, đè lên bất kỳ tab nào đang mở — không còn ép chuyển sang tab
 * "Cài từ URL" như trước (tab đó giờ chỉ còn dùng cho URL người dùng tự dán
 * tay, không liên quan gì tới hàng đợi `pendingInstall` nữa).
 */

export function SettingsExtensions() {
  const { t } = useLocale();
  const [tab, setTab] = useState<'marketplace' | 'installUrl'>('marketplace');
  const [pendingBatch, setPendingBatch] = useState<PendingInstallItem[] | null>(null);

  useEffect(() => {
    const drain = () => {
      const items = pendingInstall.dequeueAll();
      if (items.length > 0) setPendingBatch(items);
    };
    drain(); // bắt lô đã xếp sẵn TRƯỚC khi trang này mount (deep link mở app nguội)
    return pendingInstall.subscribe(drain);
  }, []);

  // Nhớ lại theo danh tính `pendingBatch`, không tính mới mỗi lần render —
  // cùng lý do đã ghi ở `SettingsMarketplace.tsx`'s `installUrls`.
  const pendingUrls = useMemo(() => pendingBatch?.map((item) => item.url) ?? [], [pendingBatch]);

  return (
    <section className="space-y-3">
      <p className="text-[11px] text-fg-mute -mt-1">{t('settings.extensions.description')}</p>

      <div className="rounded-lg border">
        <Tabs
          tabs={[
            { id: 'marketplace', label: t('settings.extensions.tabs.marketplace') },
            { id: 'installUrl', label: t('settings.extensions.tabs.installUrl') },
          ]}
          active={tab}
          onSelect={(id) => setTab(id as 'marketplace' | 'installUrl')}
        />
        <div className="p-3">
          {tab === 'marketplace' ? <SettingsMarketplace /> : <SettingsExtensionInstaller />}
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
