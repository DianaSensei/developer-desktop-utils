import { useCallback, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { isTauri } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Callout } from '@/components/ui/callout';
import { Spinner } from '@/components/ui/spinner';
import {
  assertNoConflictingInstall,
  currentTargetTriple,
  fetchArtifactManifestPreview,
  getPlugin,
  installArtifact,
  listInstalledArtifacts,
  type RemoteArtifactManifest,
} from '@/platform';

/**
 * Cài một "tiện ích" (plugin JS hoặc sidecar service native) từ một URL
 * manifest bên ngoài — thay `SettingsPluginInstaller.tsx` (chỉ biết plugin
 * JS). Xem docs/plans/native-sidecar-install.md cho bối cảnh đầy đủ và lý do
 * gộp chung một UI cho cả hai `kind` thay vì hai component song song.
 *
 * Danh sách "đã cài" (cập nhật/gỡ) không còn ở đây nữa — xem
 * `SettingsInstalledExtensions.tsx`, tab riêng của `SettingsExtensions.tsx`:
 * trước đây nó bị chôn dưới tab này, nên một người chỉ dùng Chợ tiện ích để
 * cài sẽ không bao giờ tìm ra chỗ để gỡ.
 *
 * KHÔNG áp dụng ngay lập tức: cả registry plugin (`initInstalledPlugins()`,
 * chạy đúng một lần lúc app khởi động) LẪN sidecar service (được
 * `service_host::get_or_spawn` tự spawn khi có lệnh gọi đầu tiên, không phải
 * tự khởi động lại phiên đang chạy) chỉ nhận thay đổi rõ ràng sau một lần
 * khởi động lại/gọi lại — cài xong vì vậy chỉ bật cờ "cần khởi động lại"
 * (hiện ở tab Đã cài, nơi người dùng sẽ thấy ngay sau khi chuyển qua đó).
 */
export function SettingsExtensionInstaller() {
  const { t } = useLocale();
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<RemoteArtifactManifest | null>(null);
  const [previewTriple, setPreviewTriple] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // Market đã cung cấp `url`/`preview` hiện tại — `undefined` cho một URL dán
  // tay hoặc một deep link (không gắn market nào). Đi kèm khi bấm "Cài đặt"
  // để hai market khác nhau cùng phát hành một plugin trùng id không đè lên
  // nhau (xem `installArtifact`).
  const [previewMarketId, setPreviewMarketId] = useState<string | undefined>(undefined);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  // `bin` của sidecar mà manifest đang xem trước khai cần (permissions có
  // 'service') NHƯNG chưa thấy trong danh sách đã cài — `null` khi manifest
  // không cần service nào, hoặc sidecar đó đã có sẵn. Chỉ mang tính THÔNG
  // BÁO: URL của manifest plugin không mang theo URL của service đi kèm
  // (hai tài nguyên tách biệt), nên không thể tự tải/cài hộ — khác lượt cài
  // từ Chợ tiện ích/deep link, nơi cả hai URL đã có sẵn trong tay
  // (ExtensionInstallDialog cài cả hai cùng lúc).
  const [missingServiceBin, setMissingServiceBin] = useState<string | null>(null);

  const runPreview = useCallback(async (targetUrl: string, marketId?: string) => {
    setPreview(null);
    setPreviewTriple(null);
    setPreviewError(null);
    setInstallError(null);
    setPreviewMarketId(marketId);
    setMissingServiceBin(null);
    if (!targetUrl.trim()) return;
    setPreviewing(true);
    try {
      const manifest = await fetchArtifactManifestPreview(targetUrl.trim());
      setPreview(manifest);
      if (manifest.kind === 'service') {
        // Hiển thị cho người dùng — TÍNH Ở RUST, không đoán ở phía webview
        // (cùng nguyên tắc "quyết định luôn do host" của `sidecar_path`).
        setPreviewTriple(await currentTargetTriple());
      } else if (manifest.service) {
        // Plugin này KHAI cần một sidecar — kiểm xem sidecar đó đã cài chưa,
        // để cảnh báo NGAY ở bước xem trước thay vì để người dùng tự phát
        // hiện qua lỗi "service call" mơ hồ sau khi đã cài xong.
        const installed = await listInstalledArtifacts();
        const hasService = installed.some((r) => r.kind === 'service' && r.manifest.bin === manifest.service!.bin);
        if (!hasService) setMissingServiceBin(manifest.service.bin);
      }
    } catch (e) {
      setPreviewError(String(e instanceof Error ? e.message : e));
    } finally {
      setPreviewing(false);
    }
  }, []);

  if (!isTauri) {
    return <Callout tone="info" size="sm">{t('settings.extensions.install.webWarning')}</Callout>;
  }

  // Giữ nguyên `previewMarketId` khi bấm lại Preview cho ĐÚNG url đang có sẵn
  // (vd sau khi hàng đợi tự điền + xem trước, người dùng bấm Preview lần nữa
  // để tải lại) — chỉ có ô nhập URL tự gõ tay (`onChange` bên dưới) mới thật
  // sự đổi sang URL khác và cần xoá market cũ. Bấm Preview không phải là một
  // URL mới, nên không được âm thầm làm rớt market của URL đang xem trước.
  const handlePreview = () => runPreview(url, previewMarketId);

  const handleInstall = async () => {
    setInstallError(null);
    setInstalling(true);
    try {
      if (preview?.kind === 'plugin') {
        await assertNoConflictingInstall(preview.id, previewMarketId, getPlugin(preview.id)?.group);
      }
      await installArtifact(url.trim(), previewMarketId);
      setUrl('');
      setPreview(null);
      setPreviewTriple(null);
      setNeedsRestart(true);
    } catch (e) {
      setInstallError(String(e instanceof Error ? e.message : e));
    } finally {
      setInstalling(false);
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
        <p className="text-xs font-medium">{t('settings.extensions.install.title')}</p>
        <p className="text-[11px] text-fg-mute">{t('settings.extensions.install.description')}</p>
      </div>

      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setPreview(null);
            setPreviewTriple(null);
            setPreviewError(null);
            // Gõ tay lại nghĩa là URL này không còn gắn với market vừa xem
            // trước trước đó (nếu có) — không giữ lại `previewMarketId` cũ.
            setPreviewMarketId(undefined);
          }}
          // Ví dụ URL, không phải câu chữ cần dịch — một chuỗi giống hệt nhau
          // ở cả hai ngôn ngữ trong bảng dịch bị `i18n.test.ts` coi là dấu
          // hiệu quên dịch, nên nó không thuộc về DICTIONARY.
          placeholder="https://example.com/extension.json"
          className="flex-1 font-mono text-xs"
        />
        <Button variant="outline" size="sm" onClick={() => void handlePreview()} disabled={!url.trim() || previewing}>
          {previewing ? <Spinner size="sm" /> : t('settings.extensions.install.preview')}
        </Button>
      </div>

      {previewError && <Callout tone="error" size="sm">{previewError}</Callout>}

      {preview && (
        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="rounded border px-1.5 py-0.5 font-mono text-[11px] uppercase text-fg-mute">
              {preview.kind === 'plugin' ? t('settings.extensions.install.kind.plugin') : t('settings.extensions.install.kind.service')}
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
              {missingServiceBin && (
                <Callout tone="warning" size="sm">
                  {t('settings.extensions.install.serviceDependencyMissing', { bin: missingServiceBin })}
                </Callout>
              )}
            </>
          ) : (
            <div className="space-y-1">
              {previewTriple && (
                <p className="text-[11px] text-fg-mute">
                  {t('settings.extensions.install.targetTriple', { triple: previewTriple })}
                </p>
              )}
              {previewTargetSupported !== null && (
                <p className={previewTargetSupported ? 'text-[11px] text-fg-mute' : 'text-[11px] text-bad'}>
                  {previewTargetSupported
                    ? t('settings.extensions.install.targetSupported')
                    : t('settings.extensions.install.targetUnsupported')}
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
            {installing ? <Spinner size="sm" /> : t('settings.extensions.install.confirm')}
          </Button>
        </div>
      )}

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
    </div>
  );
}
