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
 * Installs an extension (JS plugin or native sidecar) from a pasted manifest
 * URL. The installed list (update/uninstall) lives in
 * SettingsInstalledExtensions.tsx.
 *
 * Changes apply after a restart: installed plugins are registered once at
 * startup, and sidecars are spawned on first call. Installing therefore only
 * sets the "restart needed" flag.
 */
export function SettingsExtensionInstaller() {
  const { t } = useLocale();
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<RemoteArtifactManifest | null>(null);
  const [previewTriple, setPreviewTriple] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // Market that supplied the URL being previewed; `undefined` for a pasted
  // URL or a deep link. Passed to `installArtifact` on install.
  const [previewMarketId, setPreviewMarketId] = useState<string | undefined>(undefined);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  // Sidecar `bin` the previewed plugin needs but that is not installed yet.
  // Informational only: a plugin manifest does not carry its service's URL,
  // so it cannot be installed from here (the marketplace and deep links
  // install both together).
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
        // Computed by the host, not guessed in the webview.
        setPreviewTriple(await currentTargetTriple());
      } else if (manifest.service) {
        // The plugin needs a sidecar: warn now if it is missing rather than
        // after install with an obscure service error.
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

  // Re-previewing the same URL keeps its market; only typing a new URL
  // (onChange below) clears it.
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
            // A typed URL no longer belongs to the previously previewed market.
            setPreviewMarketId(undefined);
          }}
          // An example URL, identical in both languages, so it is not in
          // DICTIONARY (i18n.test.ts flags identical translations).
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
