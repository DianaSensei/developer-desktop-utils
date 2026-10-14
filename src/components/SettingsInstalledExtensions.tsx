import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Trash2 } from 'lucide-react';
import { useLocale } from '@/contexts/LocaleContext';
import { useExtensionUpdates } from '@/contexts/ExtensionUpdateContext';
import { isTauri } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Spinner } from '@/components/ui/spinner';
import { ExtensionInstallDialog } from '@/components/ExtensionInstallDialog';
import {
  checkForServiceUpdate,
  checkForUpdate,
  findCoupledRecord,
  listInstalledArtifacts,
  recordKey,
  uninstallArtifact,
  type InstalledArtifactRecord,
} from '@/platform';

/**
 * Installed extensions (plugins and services, from a market or a URL), with
 * update and uninstall in one place. Changes apply after a restart, so every
 * action ends by setting the "restart needed" flag. An update goes through
 * `ExtensionInstallDialog`, like a first install, so new permissions, hosts or
 * a changed source are shown before anything is replaced.
 */

/** The bare id or bin sent to `artifact_installer_uninstall`, unlike
 *  `recordKey`, which prefixes the market id for UI keys. */
function rawArtifactId(record: InstalledArtifactRecord): string {
  return record.kind === 'plugin' ? record.manifest.id : record.manifest.bin;
}

/** Short name of the other half of a coupled pair (`findCoupledRecord`),
 *  shown in the uninstall warning. */
function coupledLabel(record: InstalledArtifactRecord): string {
  return record.kind === 'plugin' ? record.manifest.label : record.manifest.bin;
}

/** Action awaiting confirmation on a row. Updates confirm in the install
 *  dialog instead. */
type PendingServiceAction = 'uninstall';

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
  const [updateTarget, setUpdateTarget] = useState<InstalledArtifactRecord | null>(null);
  // Stable per target so the dialog does not refetch on unrelated renders.
  const updateUrls = useMemo(() => (updateTarget ? [updateTarget.sourceUrl] : []), [updateTarget]);

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
   * Uninstalls a record together with its coupled record, if any (a tier-B
   * plugin and a sidecar nobody else uses), so neither is left orphaned.
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

  /** A plugin without a coupled sidecar is removed immediately. A service, or
   *  a plugin whose removal stops a sidecar, first shows a warning and runs
   *  after `handleConfirmServiceAction`. */
  const handleUninstallClick = (record: InstalledArtifactRecord) => {
    const coupled = findCoupledRecord(record, installed);
    if (record.kind === 'plugin' && !coupled) {
      void performUninstall(record);
      return;
    }
    setPendingServiceAction((prev) => ({ ...prev, [recordKey(record)]: 'uninstall' }));
  };

  const handleUpdateClick = (record: InstalledArtifactRecord) => {
    setUpdateTarget(record);
  };

  const handleUpdated = () => {
    if (updateTarget) {
      const key = recordKey(updateTarget);
      setRowUpdateVersion((prev) => ({ ...prev, [key]: undefined }));
    }
    setNeedsRestart(true);
    void refresh();
  };

  const handleConfirmServiceAction = (record: InstalledArtifactRecord) => {
    void performUninstall(record);
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleUpdateClick(record)}
                        disabled={busy}
                        aria-label={t('settings.extensions.installed.update')}
                        title={t('settings.extensions.installed.update')}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleCheckUpdate(record)}
                        disabled={busy}
                        aria-label={t('settings.extensions.installed.checkUpdate')}
                        title={t('settings.extensions.installed.checkUpdate')}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleUninstallClick(record)}
                      disabled={busy}
                      aria-label={t('settings.extensions.installed.uninstall')}
                      title={t('settings.extensions.installed.uninstall')}
                    >
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
                          onClick={() => handleConfirmServiceAction(record)}
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
                    {coupled && (
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

      <ExtensionInstallDialog
        urls={updateUrls}
        marketId={updateTarget?.marketId}
        open={updateTarget !== null}
        onOpenChange={(next) => {
          if (!next) setUpdateTarget(null);
        }}
        onInstalled={handleUpdated}
      />
    </div>
  );
}
