import { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Spinner } from '@/components/ui/spinner';
import {
  assertNoConflictingInstall,
  currentTargetTriple,
  fetchArtifactManifestPreview,
  getPlugin,
  installArtifact,
  type RemoteArtifactManifest,
} from '@/platform';

/**
 * Previews and installs every URL of one install request (a plugin and its
 * sidecar, if any) in a single confirmation. Used by marketplace cards and
 * `desktop-devtool-app://install` deep links. The confirmation (name,
 * permissions, source) is never skipped.
 */

interface PreviewItem {
  url: string;
  manifest?: RemoteArtifactManifest;
  error?: string;
}

interface ExtensionInstallDialogProps {
  urls: string[];
  marketId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after at least one URL installed, so the parent can refresh. */
  onInstalled?: () => void;
}

export function ExtensionInstallDialog({ urls, marketId, open, onOpenChange, onInstalled }: ExtensionInstallDialogProps) {
  const { t } = useLocale();
  const [previews, setPreviews] = useState<PreviewItem[] | null>(null);
  const [targetTriple, setTargetTriple] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) {
      setPreviews(null);
      setTargetTriple(null);
      setInstalling(false);
      setInstallError(null);
      setDone(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      // Sequential rather than Promise.all: concurrent first calls raced
      // the '@tauri-apps/api/core' mock in tests.
      const results: PreviewItem[] = [];
      for (const url of urls) {
        try {
          results.push({ url, manifest: await fetchArtifactManifestPreview(url) });
        } catch (e) {
          results.push({ url, error: String(e instanceof Error ? e.message : e) });
        }
      }
      if (cancelled) return;
      setPreviews(results);
      if (results.some((r) => r.manifest?.kind === 'service')) {
        setTargetTriple(await currentTargetTriple());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, urls]);

  const installable = (previews ?? []).filter((p): p is PreviewItem & { manifest: RemoteArtifactManifest } => !!p.manifest);

  const handleInstall = async () => {
    setInstallError(null);
    setInstalling(true);
    try {
      for (const item of installable) {
        if (item.manifest.kind === 'plugin') {
          await assertNoConflictingInstall(item.manifest.id, marketId, getPlugin(item.manifest.id)?.group);
        }
        await installArtifact(item.url, marketId);
      }
      setDone(true);
      onInstalled?.();
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('settings.extensions.install.title')}</DialogTitle>
        </DialogHeader>

        {done ? (
          <Callout
            tone="warning"
            size="sm"
            actions={
              <Button size="sm" variant="outline" onClick={() => void handleRestart()}>
                {t('settings.extensions.restart.now')}
              </Button>
            }
          >
            {t('settings.extensions.install.installed')}
          </Callout>
        ) : previews === null ? (
          <div className="flex items-center gap-2 py-4 text-xs text-fg-mute">
            <Spinner size="sm" />
            {t('settings.extensions.install.previewing')}
          </div>
        ) : (
          <div className="space-y-2">
            {previews.map((item) => (
              <div key={item.url} className="rounded-lg border p-3 space-y-2">
                {item.error ? (
                  <Callout tone="error" size="sm">{item.error}</Callout>
                ) : (
                  <ManifestPreview manifest={item.manifest!} targetTriple={targetTriple} />
                )}
              </div>
            ))}

            {installError && <Callout tone="error" size="sm">{installError}</Callout>}
          </div>
        )}

        {!done && (
          <DialogFooter>
            <Button
              size="sm"
              onClick={() => void handleInstall()}
              disabled={previews === null || installable.length === 0 || installing}
            >
              {installing ? <Spinner size="sm" /> : t('settings.extensions.install.confirm')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ManifestPreview({ manifest, targetTriple }: { manifest: RemoteArtifactManifest; targetTriple: string | null }) {
  const { t } = useLocale();
  const targetSupported =
    manifest.kind === 'service' && targetTriple ? Object.hasOwn(manifest.targets, targetTriple) : null;

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="rounded border px-1.5 py-0.5 font-mono text-[11px] uppercase text-fg-mute">
          {manifest.kind === 'plugin' ? t('settings.extensions.install.kind.plugin') : t('settings.extensions.install.kind.service')}
        </span>
        {manifest.kind === 'plugin' ? (
          <p className="text-xs font-medium">
            {manifest.label} <span className="font-mono text-fg-mute/60">{manifest.id}@{manifest.version}</span>
          </p>
        ) : (
          <p className="text-xs font-medium font-mono">{manifest.bin}@{manifest.version}</p>
        )}
      </div>

      {manifest.kind === 'plugin' ? (
        <>
          <p className="text-[11px] text-fg-mute">{manifest.description}</p>
          {manifest.permissions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {manifest.permissions.map((perm) => (
                <span key={perm} className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-fg-mute">
                  {perm}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-1">
          {targetTriple && (
            <p className="text-[11px] text-fg-mute">
              {t('settings.extensions.install.targetTriple', { triple: targetTriple })}
            </p>
          )}
          {targetSupported !== null && (
            <p className={targetSupported ? 'text-[11px] text-fg-mute' : 'text-[11px] text-bad'}>
              {targetSupported
                ? t('settings.extensions.install.targetSupported')
                : t('settings.extensions.install.targetUnsupported')}
            </p>
          )}
        </div>
      )}
    </>
  );
}
