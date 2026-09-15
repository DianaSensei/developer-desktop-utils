import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, Trash2 } from 'lucide-react';
import { useLocale } from '@/contexts/LocaleContext';
import { isTauri } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Callout } from '@/components/ui/callout';
import { Spinner } from '@/components/ui/spinner';
import {
  checkForUpdate,
  fetchManifestPreview,
  installPlugin,
  listInstalledPlugins,
  uninstallPlugin,
  type InstalledPluginRecord,
  type RemotePluginManifest,
} from '@/platform';

/**
 * Cài / cập nhật / gỡ plugin từ một URL manifest bên ngoài.
 *
 * KHÔNG áp dụng ngay lập tức: `PLUGINS` (registry) chỉ đọc plugin đã cài MỘT
 * LẦN lúc app khởi động (`main.tsx`'s `initInstalledPlugins()`), cùng mô hình
 * app đã dùng cho việc TỰ CẬP NHẬT — cài xong rồi khởi động lại, không phải
 * một quyết định riêng cho plugin. Mọi thao tác ở đây vì vậy kết thúc bằng
 * việc bật cờ "cần khởi động lại", không phải cập nhật sidebar tại chỗ.
 */
export function SettingsPluginInstaller() {
  const { t } = useLocale();
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<RemotePluginManifest | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const [installed, setInstalled] = useState<InstalledPluginRecord[]>([]);
  // id → thông báo/lỗi của thao tác đang chạy trên đúng dòng đó — tách theo id
  // để bấm "Gỡ" ở một dòng không làm dòng khác nhấp nháy trạng thái loading.
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowUpdate, setRowUpdate] = useState<Record<string, RemotePluginManifest | 'up-to-date' | undefined>>({});

  const [needsRestart, setNeedsRestart] = useState(false);

  const refresh = useCallback(async () => {
    if (!isTauri) return;
    setInstalled(await listInstalledPlugins());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!isTauri) {
    return <Callout tone="info" size="sm">{t('settings.plugins.install.webWarning')}</Callout>;
  }

  const handlePreview = async () => {
    setPreview(null);
    setPreviewError(null);
    setInstallError(null);
    if (!url.trim()) return;
    setPreviewing(true);
    try {
      setPreview(await fetchManifestPreview(url.trim()));
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
      await installPlugin(url.trim());
      setUrl('');
      setPreview(null);
      setNeedsRestart(true);
      await refresh();
    } catch (e) {
      setInstallError(String(e instanceof Error ? e.message : e));
    } finally {
      setInstalling(false);
    }
  };

  const handleUninstall = async (id: string) => {
    setRowBusy((prev) => ({ ...prev, [id]: true }));
    setRowError((prev) => ({ ...prev, [id]: '' }));
    try {
      await uninstallPlugin(id);
      setNeedsRestart(true);
      await refresh();
    } catch (e) {
      setRowError((prev) => ({ ...prev, [id]: String(e instanceof Error ? e.message : e) }));
    } finally {
      setRowBusy((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleCheckUpdate = async (record: InstalledPluginRecord) => {
    const id = record.manifest.id;
    setRowBusy((prev) => ({ ...prev, [id]: true }));
    setRowError((prev) => ({ ...prev, [id]: '' }));
    try {
      const { available, remote } = await checkForUpdate(record);
      setRowUpdate((prev) => ({ ...prev, [id]: available ? remote : 'up-to-date' }));
    } catch (e) {
      setRowError((prev) => ({ ...prev, [id]: String(e instanceof Error ? e.message : e) }));
    } finally {
      setRowBusy((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleUpdate = async (record: InstalledPluginRecord) => {
    const id = record.manifest.id;
    setRowBusy((prev) => ({ ...prev, [id]: true }));
    setRowError((prev) => ({ ...prev, [id]: '' }));
    try {
      // Cùng URL đã cài từ — `plugin_installer_install` phía Rust thay hẳn bản
      // ghi cũ khi id trùng, nên "cập nhật" chỉ là "cài lại từ đúng nguồn".
      await installPlugin(record.sourceUrl);
      setRowUpdate((prev) => ({ ...prev, [id]: undefined }));
      setNeedsRestart(true);
      await refresh();
    } catch (e) {
      setRowError((prev) => ({ ...prev, [id]: String(e instanceof Error ? e.message : e) }));
    } finally {
      setRowBusy((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleRestart = async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium">{t('settings.plugins.install.title')}</p>
        <p className="text-[11px] text-fg-mute">{t('settings.plugins.install.description')}</p>
      </div>

      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => { setUrl(e.target.value); setPreview(null); setPreviewError(null); }}
          // Ví dụ URL, không phải câu chữ cần dịch — một chuỗi giống hệt nhau
          // ở cả hai ngôn ngữ trong bảng dịch bị `i18n.test.ts` coi là dấu
          // hiệu quên dịch, nên nó không thuộc về DICTIONARY.
          placeholder="https://example.com/plugin.json"
          className="flex-1 font-mono text-xs"
        />
        <Button variant="outline" size="sm" onClick={() => void handlePreview()} disabled={!url.trim() || previewing}>
          {previewing ? <Spinner size="sm" /> : t('settings.plugins.install.preview')}
        </Button>
      </div>

      {previewError && <Callout tone="error" size="sm">{previewError}</Callout>}

      {preview && (
        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-xs font-medium">
            {preview.label} <span className="font-mono text-fg-mute/60">{preview.id}@{preview.version}</span>
          </p>
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
            const id = record.manifest.id;
            const busy = rowBusy[id] ?? false;
            const update = rowUpdate[id];
            return (
              <div key={id} className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-xs font-medium">
                    {record.manifest.label}{' '}
                    <span className="font-mono text-fg-mute/60">{id}@{record.manifest.version}</span>
                  </p>
                  <p className="truncate font-mono text-[11px] text-fg-mute/70">{record.sourceUrl}</p>
                  {rowError[id] && <p className="text-[11px] text-bad">{rowError[id]}</p>}
                  {update === 'up-to-date' && (
                    <p className="text-[11px] text-fg-mute">{t('settings.plugins.installed.upToDate')}</p>
                  )}
                  {update && update !== 'up-to-date' && (
                    <p className="text-[11px] text-warn">
                      {t('settings.plugins.installed.updateAvailable', { version: update.version })}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {update && update !== 'up-to-date' ? (
                    <Button size="sm" variant="outline" onClick={() => void handleUpdate(record)} disabled={busy}>
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => void handleCheckUpdate(record)} disabled={busy}>
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => void handleUninstall(id)} disabled={busy}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
