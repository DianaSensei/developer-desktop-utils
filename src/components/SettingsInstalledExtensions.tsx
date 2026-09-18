import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, Trash2 } from 'lucide-react';
import { useLocale } from '@/contexts/LocaleContext';
import { useExtensionUpdates } from '@/contexts/ExtensionUpdateContext';
import { isTauri } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Spinner } from '@/components/ui/spinner';
import {
  checkForServiceUpdate,
  checkForUpdate,
  findCoupledRecord,
  installPlugin,
  installService,
  listInstalledArtifacts,
  recordKey,
  uninstallArtifact,
  type InstalledArtifactRecord,
} from '@/platform';

/**
 * Danh sách tiện ích ĐÃ CÀI (cả plugin lẫn service, bất kể cài qua Chợ tiện
 * ích hay dán URL tay) — cập nhật/gỡ tại đây, một chỗ DUY NHẤT, không phụ
 * thuộc vào việc người dùng đã cài nó bằng đường nào. Tách khỏi
 * `SettingsExtensionInstaller.tsx` (chỉ còn form "dán URL cài mới") thành tab
 * riêng của `SettingsExtensions.tsx` — trước đây danh sách này BỊ CHÔN dưới
 * tab "Cài từ URL", nên một người chỉ dùng tab "Chợ tiện ích" để cài sẽ không
 * bao giờ tìm ra chỗ để gỡ.
 *
 * Cùng lý do "không áp dụng ngay lập tức" đã ghi ở SettingsExtensionInstaller:
 * mọi thao tác ở đây kết thúc bằng cờ "cần khởi động lại", không phải cập
 * nhật UI tại chỗ ngay.
 */

/** id/bin THẬT gửi xuống Rust (`artifact_installer_uninstall`'s `key`) —
 *  khác `recordKey` (dùng làm khoá React/UI) khi record có `marketId`: xem
 *  giải thích đầy đủ ở bản gốc trong SettingsExtensionInstaller.tsx. */
function rawArtifactId(record: InstalledArtifactRecord): string {
  return record.kind === 'plugin' ? record.manifest.id : record.manifest.bin;
}

/** Tên hiển thị ngắn gọn cho bản ghi PHÍA BÊN KIA của một cặp liên quan
 *  (`findCoupledRecord`) — dùng trong lời cảnh báo trước khi gỡ, để người
 *  dùng biết CHÍNH XÁC cái gì sẽ bị gỡ theo, không chỉ "một thứ liên quan". */
function coupledLabel(record: InstalledArtifactRecord): string {
  return record.kind === 'plugin' ? record.manifest.label : record.manifest.bin;
}

/** Hành động đang chờ người dùng xác nhận cho một dòng `kind=service` — chỉ
 *  service mới cần bước xác nhận thêm này. */
type PendingServiceAction = 'update' | 'uninstall';

export function SettingsInstalledExtensions() {
  const { t } = useLocale();
  const { updates: autoUpdates } = useExtensionUpdates();

  const [installed, setInstalled] = useState<InstalledArtifactRecord[]>([]);
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowUpdateVersion, setRowUpdateVersion] = useState<Record<string, string | 'up-to-date' | undefined>>({});
  const [pendingServiceAction, setPendingServiceAction] = useState<Record<string, PendingServiceAction | undefined>>(
    {},
  );
  const [needsRestart, setNeedsRestart] = useState(false);

  const refresh = useCallback(async () => {
    if (!isTauri) return;
    setInstalled(await listInstalledArtifacts());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (autoUpdates.length === 0) return;
    setRowUpdateVersion((prev) => {
      const next = { ...prev };
      for (const u of autoUpdates) next[u.key] = u.remoteVersion;
      return next;
    });
  }, [autoUpdates]);

  if (!isTauri) {
    return <Callout tone="info" size="sm">{t('settings.extensions.install.webWarning')}</Callout>;
  }

  /**
   * Gỡ MỘT bản ghi — cùng lúc gỡ theo bản ghi LIÊN QUAN đến nó, nếu có
   * (`findCoupledRecord`: một plugin Tier B và sidecar riêng của nó, khi
   * không ai khác dùng chung sidecar đó). Bỏ lại phần kia sẽ để một sidecar
   * mồ côi (không tool nào gọi tới) hoặc một plugin gọi vào một bin đã biến
   * mất — hai phần ĐỘC LẬP (sidecar dùng chung, hoặc không ai phụ thuộc) thì
   * không bị kéo theo, `coupled` khi đó là `undefined`.
   */
  const performUninstall = async (record: InstalledArtifactRecord) => {
    const key = recordKey(record);
    const coupled = findCoupledRecord(record, installed);
    const coupledKey = coupled ? recordKey(coupled) : undefined;
    setRowBusy((prev) => ({ ...prev, [key]: true, ...(coupledKey ? { [coupledKey]: true } : {}) }));
    setRowError((prev) => ({ ...prev, [key]: '' }));
    try {
      await uninstallArtifact(rawArtifactId(record), record.marketId);
      if (coupled) {
        await uninstallArtifact(rawArtifactId(coupled), coupled.marketId);
      }
      setNeedsRestart(true);
      await refresh();
    } catch (e) {
      setRowError((prev) => ({ ...prev, [key]: String(e instanceof Error ? e.message : e) }));
    } finally {
      setRowBusy((prev) => ({ ...prev, [key]: false, ...(coupledKey ? { [coupledKey]: false } : {}) }));
      setPendingServiceAction((prev) => ({
        ...prev,
        [key]: undefined,
        ...(coupledKey ? { [coupledKey]: undefined } : {}),
      }));
    }
  };

  const performUpdate = async (record: InstalledArtifactRecord) => {
    const key = recordKey(record);
    setRowBusy((prev) => ({ ...prev, [key]: true }));
    setRowError((prev) => ({ ...prev, [key]: '' }));
    try {
      if (record.kind === 'plugin') {
        await installPlugin(record.sourceUrl, record.marketId);
      } else {
        await installService(record.sourceUrl, record.marketId);
      }
      setRowUpdateVersion((prev) => ({ ...prev, [key]: undefined }));
      setNeedsRestart(true);
      await refresh();
    } catch (e) {
      setRowError((prev) => ({ ...prev, [key]: String(e instanceof Error ? e.message : e) }));
    } finally {
      setRowBusy((prev) => ({ ...prev, [key]: false }));
      setPendingServiceAction((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  /** Plugin KHÔNG có sidecar liên quan: thực hiện ngay (không có tiến trình
   *  nào bị dừng). Service, hoặc một plugin CÓ sidecar liên quan (gỡ nó kéo
   *  theo dừng sidecar đó): bước đầu chỉ HIỆN cảnh báo, hành động thật chỉ
   *  chạy sau khi người dùng bấm "Xác nhận" ở `handleConfirmServiceAction`. */
  const handleUninstallClick = (record: InstalledArtifactRecord) => {
    const coupled = findCoupledRecord(record, installed);
    if (record.kind === 'plugin' && !coupled) {
      void performUninstall(record);
      return;
    }
    setPendingServiceAction((prev) => ({ ...prev, [recordKey(record)]: 'uninstall' }));
  };

  const handleUpdateClick = (record: InstalledArtifactRecord) => {
    if (record.kind === 'plugin') {
      void performUpdate(record);
      return;
    }
    setPendingServiceAction((prev) => ({ ...prev, [recordKey(record)]: 'update' }));
  };

  const handleConfirmServiceAction = (record: InstalledArtifactRecord, action: PendingServiceAction) => {
    if (action === 'update') {
      void performUpdate(record);
    } else {
      void performUninstall(record);
    }
  };

  const handleCancelServiceAction = (key: string) => {
    setPendingServiceAction((prev) => ({ ...prev, [key]: undefined }));
  };

  const handleCheckUpdate = async (record: InstalledArtifactRecord) => {
    const key = recordKey(record);
    setRowBusy((prev) => ({ ...prev, [key]: true }));
    setRowError((prev) => ({ ...prev, [key]: '' }));
    try {
      const { available, remote } =
        record.kind === 'plugin' ? await checkForUpdate(record) : await checkForServiceUpdate(record);
      setRowUpdateVersion((prev) => ({ ...prev, [key]: available && remote ? remote.version : 'up-to-date' }));
    } catch (e) {
      setRowError((prev) => ({ ...prev, [key]: String(e instanceof Error ? e.message : e) }));
    } finally {
      setRowBusy((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleRestart = async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  };

  return (
    <div className="space-y-3">
      {needsRestart && (
        <Callout
          tone="warning"
          size="sm"
          actions={
            <Button size="sm" variant="outline" onClick={() => void handleRestart()}>
              {t('settings.extensions.restart.now')}
            </Button>
          }
        >
          {t('settings.extensions.restart.needed')}
        </Callout>
      )}

      <div className="rounded-lg border divide-y">
        {installed.length === 0 ? (
          <p className="px-4 py-3 text-[11px] text-fg-mute">{t('settings.extensions.installed.empty')}</p>
        ) : (
          installed.map((record) => {
            const key = recordKey(record);
            const busy = rowBusy[key] ?? false;
            const updateVersion = rowUpdateVersion[key];
            const pending = pendingServiceAction[key];
            const coupled = findCoupledRecord(record, installed);
            return (
              <div key={key} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="flex items-center gap-1.5 text-xs font-medium">
                      <span className="rounded border px-1.5 py-0.5 font-mono text-[11px] uppercase text-fg-mute">
                        {record.kind === 'plugin'
                          ? t('settings.extensions.install.kind.plugin')
                          : t('settings.extensions.install.kind.service')}
                      </span>
                      {record.kind === 'plugin' ? (
                        <>
                          {record.manifest.label}{' '}
                          <span className="font-mono text-fg-mute/60">{record.manifest.id}@{record.manifest.version}</span>
                        </>
                      ) : (
                        <span className="font-mono">{record.manifest.bin}@{record.manifest.version}</span>
                      )}
                      {record.marketId && (
                        <span className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-fg-mute/70">
                          {record.marketId}
                        </span>
                      )}
                    </p>
                    <p className="truncate font-mono text-[11px] text-fg-mute/70">{record.sourceUrl}</p>
                    {rowError[key] && <p className="text-[11px] text-bad">{rowError[key]}</p>}
                    {updateVersion === 'up-to-date' && (
                      <p className="text-[11px] text-fg-mute">{t('settings.extensions.installed.upToDate')}</p>
                    )}
                    {updateVersion && updateVersion !== 'up-to-date' && (
                      <p className="text-[11px] text-warn">
                        {t('settings.extensions.installed.updateAvailable', { version: updateVersion })}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {updateVersion && updateVersion !== 'up-to-date' ? (
                      <Button size="sm" variant="outline" onClick={() => handleUpdateClick(record)} disabled={busy}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => void handleCheckUpdate(record)} disabled={busy}>
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => handleUninstallClick(record)} disabled={busy}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {pending && (
                  <Callout
                    tone="warning"
                    size="sm"
                    actions={
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleConfirmServiceAction(record, pending)}
                          disabled={busy}
                        >
                          {busy ? <Spinner size="sm" /> : t('settings.extensions.installed.confirm')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleCancelServiceAction(key)} disabled={busy}>
                          {t('settings.extensions.installed.cancel')}
                        </Button>
                      </div>
                    }
                  >
                    {pending === 'uninstall' && coupled && (
                      <p className="mb-1 font-medium">
                        {t('settings.extensions.installed.coupledUninstallNote', { label: coupledLabel(coupled) })}
                      </p>
                    )}
                    {record.kind === 'service' && t('settings.extensions.installed.serviceWarning')}
                  </Callout>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
