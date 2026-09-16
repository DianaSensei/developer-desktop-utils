import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, Trash2 } from 'lucide-react';
import { useLocale } from '@/contexts/LocaleContext';
import { useExtensionUpdates } from '@/contexts/ExtensionUpdateContext';
import { isTauri } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Callout } from '@/components/ui/callout';
import { Spinner } from '@/components/ui/spinner';
import {
  checkForServiceUpdate,
  checkForUpdate,
  currentTargetTriple,
  fetchArtifactManifestPreview,
  installArtifact,
  installPlugin,
  installService,
  listInstalledArtifacts,
  uninstallArtifact,
  type InstalledArtifactRecord,
  type RemoteArtifactManifest,
} from '@/platform';

/**
 * Cài / cập nhật / gỡ một "tiện ích" (plugin JS hoặc sidecar service native)
 * từ một URL manifest bên ngoài — thay `SettingsPluginInstaller.tsx` (chỉ
 * biết plugin JS). Xem docs/plans/native-sidecar-install.md cho bối cảnh đầy
 * đủ và lý do gộp chung một UI cho cả hai `kind` thay vì hai component song
 * song.
 *
 * KHÔNG áp dụng ngay lập tức: cả registry plugin (`initInstalledPlugins()`,
 * chạy đúng một lần lúc app khởi động) LẪN sidecar service (được
 * `service_host::get_or_spawn` tự spawn khi có lệnh gọi đầu tiên, không phải
 * tự khởi động lại phiên đang chạy) chỉ nhận thay đổi rõ ràng sau một lần
 * khởi động lại/gọi lại — mọi thao tác ở đây vì vậy kết thúc bằng việc bật cờ
 * "cần khởi động lại", không phải cập nhật UI tại chỗ ngay lập tức. Riêng
 * service, cập nhật/gỡ còn tự dừng tiến trình cũ ngay lập tức ở phía Rust
 * (self-healing — lần gọi service kế tiếp tự spawn lại bản mới), nên cảnh báo
 * ngắt-kết-nối bên dưới KHÔNG phải chuyện lý thuyết.
 */

function recordKey(record: InstalledArtifactRecord): string {
  return record.kind === 'plugin' ? record.manifest.id : record.manifest.bin;
}

/** Hành động đang chờ người dùng xác nhận cho một dòng `kind=service` — chỉ
 *  service mới cần bước xác nhận thêm này (xem lời giải thích ở đầu file và
 *  DoD của plan: "một cảnh báo chung là đủ", không cần phát hiện thật một
 *  kết nối/stream đang mở). */
type PendingServiceAction = 'update' | 'uninstall';

export function SettingsExtensionInstaller() {
  const { t } = useLocale();
  const { updates: autoUpdates } = useExtensionUpdates();
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<RemoteArtifactManifest | null>(null);
  const [previewTriple, setPreviewTriple] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const [installed, setInstalled] = useState<InstalledArtifactRecord[]>([]);
  // key (id hoặc bin) → thông báo/lỗi của thao tác đang chạy trên đúng dòng đó
  // — tách theo key để bấm "Gỡ" ở một dòng không làm dòng khác nhấp nháy
  // trạng thái loading.
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowUpdateVersion, setRowUpdateVersion] = useState<Record<string, string | 'up-to-date' | undefined>>({});
  // Bước xác nhận riêng cho service — plugin không cần bước này (không có
  // tiến trình nào bị dừng khi cài đè/gỡ một plugin JS).
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

  // ExtensionUpdateContext đã tự kiểm mọi artifact lúc app khởi động — dùng
  // kết quả đó để hiện sẵn nút "Update" ngay khi mở trang này, thay vì bắt
  // người dùng bấm "Check for update" từng dòng trước (nút đó vẫn còn, cho
  // trường hợp một artifact đổi version SAU lần kiểm lúc khởi động).
  useEffect(() => {
    if (autoUpdates.length === 0) return;
    setRowUpdateVersion((prev) => {
      const next = { ...prev };
      for (const u of autoUpdates) next[u.key] = u.remoteVersion;
      return next;
    });
  }, [autoUpdates]);

  if (!isTauri) {
    return <Callout tone="info" size="sm">{t('settings.plugins.install.webWarning')}</Callout>;
  }

  const handlePreview = async () => {
    setPreview(null);
    setPreviewTriple(null);
    setPreviewError(null);
    setInstallError(null);
    if (!url.trim()) return;
    setPreviewing(true);
    try {
      const manifest = await fetchArtifactManifestPreview(url.trim());
      setPreview(manifest);
      if (manifest.kind === 'service') {
        // Hiển thị cho người dùng — TÍNH Ở RUST, không đoán ở phía webview
        // (cùng nguyên tắc "quyết định luôn do host" của `sidecar_path`).
        setPreviewTriple(await currentTargetTriple());
      }
    } catch (e) {
      setPreviewError(String(e instanceof Error ? e.message : e));
    } finally {
      setPreviewing(false);
    }
  };

  const handleInstall = async () => {
    setInstallError(null);
    setInstalling(true);
    try {
      await installArtifact(url.trim());
      setUrl('');
      setPreview(null);
      setPreviewTriple(null);
      setNeedsRestart(true);
      await refresh();
    } catch (e) {
      setInstallError(String(e instanceof Error ? e.message : e));
    } finally {
      setInstalling(false);
    }
  };

  const performUninstall = async (record: InstalledArtifactRecord) => {
    const key = recordKey(record);
    setRowBusy((prev) => ({ ...prev, [key]: true }));
    setRowError((prev) => ({ ...prev, [key]: '' }));
    try {
      await uninstallArtifact(key);
      setNeedsRestart(true);
      await refresh();
    } catch (e) {
      setRowError((prev) => ({ ...prev, [key]: String(e instanceof Error ? e.message : e) }));
    } finally {
      setRowBusy((prev) => ({ ...prev, [key]: false }));
      setPendingServiceAction((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  const performUpdate = async (record: InstalledArtifactRecord) => {
    const key = recordKey(record);
    setRowBusy((prev) => ({ ...prev, [key]: true }));
    setRowError((prev) => ({ ...prev, [key]: '' }));
    try {
      // Cùng URL đã cài từ — `artifact_installer_install` phía Rust thay hẳn
      // bản ghi cũ khi key trùng, nên "cập nhật" chỉ là "cài lại từ đúng
      // nguồn".
      if (record.kind === 'plugin') {
        await installPlugin(record.sourceUrl);
      } else {
        await installService(record.sourceUrl);
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

  /** Plugin: thực hiện ngay (không có tiến trình nào bị dừng). Service: bước
   *  đầu chỉ HIỆN cảnh báo, hành động thật chỉ chạy sau khi người dùng bấm
   *  "Xác nhận" ở `handleConfirmServiceAction`. */
  const handleUninstallClick = (record: InstalledArtifactRecord) => {
    if (record.kind === 'plugin') {
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

  const previewTargetSupported =
    preview?.kind === 'service' && previewTriple ? Object.hasOwn(preview.targets, previewTriple) : null;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium">{t('settings.plugins.install.title')}</p>
        <p className="text-[11px] text-fg-mute">{t('settings.plugins.install.description')}</p>
      </div>

      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => { setUrl(e.target.value); setPreview(null); setPreviewTriple(null); setPreviewError(null); }}
          // Ví dụ URL, không phải câu chữ cần dịch — một chuỗi giống hệt nhau
          // ở cả hai ngôn ngữ trong bảng dịch bị `i18n.test.ts` coi là dấu
          // hiệu quên dịch, nên nó không thuộc về DICTIONARY.
          placeholder="https://example.com/extension.json"
          className="flex-1 font-mono text-xs"
        />
        <Button variant="outline" size="sm" onClick={() => void handlePreview()} disabled={!url.trim() || previewing}>
          {previewing ? <Spinner size="sm" /> : t('settings.plugins.install.preview')}
        </Button>
      </div>

      {previewError && <Callout tone="error" size="sm">{previewError}</Callout>}

      {preview && (
        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="rounded border px-1.5 py-0.5 font-mono text-[11px] uppercase text-fg-mute">
              {preview.kind === 'plugin' ? t('settings.plugins.install.kind.plugin') : t('settings.plugins.install.kind.service')}
            </span>
            {preview.kind === 'plugin' ? (
              <p className="text-xs font-medium">
                {preview.label} <span className="font-mono text-fg-mute/60">{preview.id}@{preview.version}</span>
              </p>
            ) : (
              <p className="text-xs font-medium font-mono">{preview.bin}@{preview.version}</p>
            )}
          </div>

          {preview.kind === 'plugin' ? (
            <>
              <p className="text-[11px] text-fg-mute">{preview.description}</p>
              {preview.permissions.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {preview.permissions.map((perm) => (
                    <span key={perm} className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-fg-mute">
                      {perm}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-1">
              {previewTriple && (
                <p className="text-[11px] text-fg-mute">
                  {t('settings.plugins.install.targetTriple', { triple: previewTriple })}
                </p>
              )}
              {previewTargetSupported !== null && (
                <p className={previewTargetSupported ? 'text-[11px] text-fg-mute' : 'text-[11px] text-bad'}>
                  {previewTargetSupported
                    ? t('settings.plugins.install.targetSupported')
                    : t('settings.plugins.install.targetUnsupported')}
                </p>
              )}
              <div className="flex flex-wrap gap-1">
                {Object.keys(preview.targets).map((triple) => (
                  <span key={triple} className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-fg-mute">
                    {triple}
                  </span>
                ))}
              </div>
            </div>
          )}

          {installError && <Callout tone="error" size="sm">{installError}</Callout>}
          <Button size="sm" onClick={() => void handleInstall()} disabled={installing}>
            {installing ? <Spinner size="sm" /> : t('settings.plugins.install.confirm')}
          </Button>
        </div>
      )}

      {needsRestart && (
        <Callout
          tone="warning"
          size="sm"
          actions={
            <Button size="sm" variant="outline" onClick={() => void handleRestart()}>
              {t('settings.plugins.restart.now')}
            </Button>
          }
        >
          {t('settings.plugins.restart.needed')}
        </Callout>
      )}

      <div className="space-y-1.5 pt-1">
        <p className="text-xs font-medium">{t('settings.plugins.installed.title')}</p>
      </div>

      <div className="rounded-lg border divide-y">
        {installed.length === 0 ? (
          <p className="px-4 py-3 text-[11px] text-fg-mute">{t('settings.plugins.installed.empty')}</p>
        ) : (
          installed.map((record) => {
            const key = recordKey(record);
            const busy = rowBusy[key] ?? false;
            const updateVersion = rowUpdateVersion[key];
            const pending = pendingServiceAction[key];
            return (
              <div key={key} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="flex items-center gap-1.5 text-xs font-medium">
                      <span className="rounded border px-1.5 py-0.5 font-mono text-[11px] uppercase text-fg-mute">
                        {record.kind === 'plugin'
                          ? t('settings.plugins.install.kind.plugin')
                          : t('settings.plugins.install.kind.service')}
                      </span>
                      {record.kind === 'plugin' ? (
                        <>
                          {record.manifest.label}{' '}
                          <span className="font-mono text-fg-mute/60">{key}@{record.manifest.version}</span>
                        </>
                      ) : (
                        <span className="font-mono">{key}@{record.manifest.version}</span>
                      )}
                    </p>
                    <p className="truncate font-mono text-[11px] text-fg-mute/70">{record.sourceUrl}</p>
                    {rowError[key] && <p className="text-[11px] text-bad">{rowError[key]}</p>}
                    {updateVersion === 'up-to-date' && (
                      <p className="text-[11px] text-fg-mute">{t('settings.plugins.installed.upToDate')}</p>
                    )}
                    {updateVersion && updateVersion !== 'up-to-date' && (
                      <p className="text-[11px] text-warn">
                        {t('settings.plugins.installed.updateAvailable', { version: updateVersion })}
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
                          {busy ? <Spinner size="sm" /> : t('settings.plugins.installed.confirm')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleCancelServiceAction(key)} disabled={busy}>
                          {t('settings.plugins.installed.cancel')}
                        </Button>
                      </div>
                    }
                  >
                    {t('settings.plugins.installed.serviceWarning')}
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
