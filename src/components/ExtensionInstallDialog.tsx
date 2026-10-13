import { useEffect, useId, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Spinner } from '@/components/ui/spinner';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ExtensionManifestPreview,
  findReplacedRecord,
  replacementNeedsAcknowledgement,
} from '@/components/ExtensionManifestPreview';
import {
  assertNoConflictingInstall,
  currentTargetTriple,
  fetchArtifactManifestPreview,
  getPlugin,
  installArtifact,
  listInstalledArtifacts,
  type InstalledArtifactRecord,
  type RemoteArtifactManifest,
} from '@/platform';

/**
 * Previews and installs every URL of one install request (a plugin and its
 * sidecar, if any) in a single confirmation. Used by marketplace cards and
 * `desktop-devtool-app://install` deep links, and updates of installed
 * extensions. The confirmation (name, permissions, hosts, source, what it
 * replaces) is never skipped, and the install is refused if the source
 * serves a different manifest than the one shown.
 */

interface PreviewItem {
  url: string;
  manifest?: RemoteArtifactManifest;
  /** Installed copy this item would replace. */
  replaced?: InstalledArtifactRecord;
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
  const [acknowledged, setAcknowledged] = useState(false);
  const ackId = useId();

  useEffect(() => {
    // Reset on close and on every new batch (a second deep link can arrive
    // while the dialog is open).
    setPreviews(null);
    setTargetTriple(null);
    setInstalling(false);
    setInstallError(null);
    setDone(false);
    setAcknowledged(false);
    if (!open) return;
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
      let installed: InstalledArtifactRecord[] = [];
      try {
        installed = await listInstalledArtifacts();
      } catch {
        // Without the list nothing is marked as replaced; the install call
        // still reports a conflicting source.
      }
      for (const item of results) {
        if (item.manifest) item.replaced = findReplacedRecord(item.manifest, installed);
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
  const needsAcknowledgement = installable.some((p) => replacementNeedsAcknowledgement(p.manifest, p.url, p.replaced));

  const handleInstall = async () => {
    setInstallError(null);
    setInstalling(true);
    try {
      for (const item of installable) {
        if (item.manifest.kind === 'plugin') {
          await assertNoConflictingInstall(item.manifest.id, marketId, getPlugin(item.manifest.id)?.group);
        }
        // Rust re-fetches the manifest; passing the previewed one makes it
        // refuse anything the user did not see.
        await installArtifact(item.url, marketId, item.manifest);
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
                  <ExtensionManifestPreview
                    manifest={item.manifest!}
                    sourceUrl={item.url}
                    targetTriple={targetTriple}
                    replaced={item.replaced}
                  />
                )}
              </div>
            ))}

            {needsAcknowledgement && (
              <div className="flex items-start gap-2">
                <Checkbox id={ackId} size="sm" checked={acknowledged} onCheckedChange={setAcknowledged} className="mt-0.5" />
                <label htmlFor={ackId} className="text-[11px]">{t('settings.extensions.install.acknowledge')}</label>
              </div>
            )}

            {installError && <Callout tone="error" size="sm">{installError}</Callout>}
          </div>
        )}

        {!done && (
          <DialogFooter>
            <Button
              size="sm"
              onClick={() => void handleInstall()}
              disabled={
                previews === null || installable.length === 0 || installing || (needsAcknowledgement && !acknowledged)
              }
            >
              {installing ? <Spinner size="sm" /> : t('settings.extensions.install.confirm')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
