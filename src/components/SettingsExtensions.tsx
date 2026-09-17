import { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { SettingsExtensionInstaller } from '@/components/SettingsExtensionInstaller';
import { SettingsMarketplace } from '@/components/SettingsMarketplace';
import { Tabs } from '@/components/ui/tabs';
import { pendingInstall } from '@/lib/pendingInstall';

/**
 * Settings → Extensions: cài THÊM plugin/sidecar KHÔNG có sẵn trong bản
 * biên dịch của app, qua Chợ tiện ích hoặc dán URL manifest tay. Tách khỏi
 * Settings → Plugins (danh sách tool biên dịch sẵn + nhật ký) — hai câu hỏi
 * khác nhau: "app này có những plugin nào sẵn, quyền gì" so với "tôi muốn
 * cài thêm cái gì đó KHÔNG có sẵn".
 */

export function SettingsExtensions() {
  const { t } = useLocale();
  // Market trước, "dán URL tay" sau — market là đường chính để phát hiện +
  // cài tiện ích, URL trần vẫn giữ cho nguồn không nằm trong market nào (một
  // link do đồng nghiệp gửi riêng, một bản build thử) và là nơi
  // SettingsMarketplace tự chuyển tới sau khi bấm Install (xem đó).
  //
  // NGOẠI LỆ: một deep link `desktop-devtool-app://install` đã xếp sẵn URL
  // vào `pendingInstall` TRƯỚC khi trang này mount (app mở nguội thẳng vào
  // đây) phải mở đúng tab "Cài từ URL" ngay từ đầu — đó là tab DUY NHẤT có
  // `SettingsExtensionInstaller` để tự kéo hàng đợi ra xem trước; mặc định
  // "Chợ tiện ích" sẽ không bao giờ mount nó, và URL nằm im không ai thấy.
  const [tab, setTab] = useState<'marketplace' | 'installUrl'>(() =>
    pendingInstall.hasPending() ? 'installUrl' : 'marketplace',
  );

  // Cùng lý do, cho trường hợp app ĐÃ đang mở sẵn ở trang này (dù đang đứng
  // ở tab nào) khi một deep link thứ hai tới — single-instance (main.rs)
  // chuyển tiếp URL sang tiến trình đang chạy, `pendingInstall` phát
  // `notify()`, nhưng nếu tab hiện tại là "Chợ tiện ích" thì
  // `SettingsExtensionInstaller` chưa hề mount để tự nghe hàng đợi. Chuyển
  // tab ở đây đảm bảo nó mount và effect nạp-lúc-mount của chính nó tự kéo ra.
  useEffect(() => pendingInstall.subscribe(() => setTab('installUrl')), []);

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
          {tab === 'marketplace' ? (
            <SettingsMarketplace onInstallRequested={() => setTab('installUrl')} />
          ) : (
            <SettingsExtensionInstaller />
          )}
        </div>
      </div>
    </section>
  );
}
