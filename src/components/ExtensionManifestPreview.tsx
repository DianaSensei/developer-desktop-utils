import type { ReactNode } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { Callout } from '@/components/ui/callout';
import { compareVersions } from '@/lib/semver';
import { cn } from '@/lib/utils';
import type { InstalledArtifactRecord, RemoteArtifactManifest } from '@/platform';

/**
 * What the user approves before an extension is installed: what it is, where
 * it comes from, what it may access, and what it replaces. Shared by the
 * install dialog (marketplace, deep links, updates) and the paste-URL form so
 * every path shows the same facts.
 */

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The installed copy this manifest would replace: same plugin id (from any
 *  source) or same service bin. */
export function findReplacedRecord(
  manifest: RemoteArtifactManifest,
  installed: InstalledArtifactRecord[],
): InstalledArtifactRecord | undefined {
  return installed.find((r) =>
    manifest.kind === 'plugin'
      ? r.kind === 'plugin' && r.manifest.id === manifest.id
      : r.kind === 'service' && r.manifest.bin === manifest.bin,
  );
}

/** A downgrade or a different source host is easy to slip past in a dialog
 *  that otherwise looks like any other install, so it needs an explicit
 *  acknowledgement. */
export function replacementNeedsAcknowledgement(
  manifest: RemoteArtifactManifest,
  sourceUrl: string,
  replaced: InstalledArtifactRecord | undefined,
): boolean {
  if (!replaced) return false;
  return (
    compareVersions(manifest.version, replaced.manifest.version) < 0 ||
    hostOf(sourceUrl) !== hostOf(replaced.sourceUrl)
  );
}

function Chips({ items, added, label }: { items: string[]; added: Set<string>; label?: string }) {
  const { t } = useLocale();
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {label && <span className="text-[11px] text-fg-mute">{label}</span>}
      {items.map((item) => (
        <span
          key={item}
          className={cn(
            'rounded border px-1.5 py-0.5 font-mono text-[11px]',
            added.has(item) ? 'border-warn/50 text-warn' : 'text-fg-mute',
          )}
        >
          {item}
          {added.has(item) && <span className="ml-1 font-sans">({t('settings.extensions.install.newBadge')})</span>}
        </span>
      ))}
    </div>
  );
}

export function ExtensionManifestPreview({
  manifest,
  sourceUrl,
  targetTriple,
  replaced,
  children,
}: {
  manifest: RemoteArtifactManifest;
  sourceUrl: string;
  targetTriple: string | null;
  replaced?: InstalledArtifactRecord;
  children?: ReactNode;
}) {
  const { t } = useLocale();
  const targetSupported =
    manifest.kind === 'service' && targetTriple ? Object.hasOwn(manifest.targets, targetTriple) : null;

  // Only a replaced plugin has a baseline to compare against; a first
  // install shows everything plainly.
  const before = replaced?.kind === 'plugin' ? replaced.manifest : undefined;
  const addedPermissions = new Set(
    manifest.kind === 'plugin' && before ? manifest.permissions.filter((p) => !before.permissions.includes(p)) : [],
  );
  const addedHosts = new Set(
    manifest.kind === 'plugin' && before ? manifest.hosts.filter((h) => !before.hosts.includes(h)) : [],
  );
  const downgrade = replaced ? compareVersions(manifest.version, replaced.manifest.version) < 0 : false;
  const sourceChanged = replaced ? hostOf(sourceUrl) !== hostOf(replaced.sourceUrl) : false;

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="rounded border px-1.5 py-0.5 font-mono text-[11px] uppercase text-fg-mute">
          {manifest.kind === 'plugin' ? t('settings.extensions.install.kind.plugin') : t('settings.extensions.install.kind.service')}
        </span>
        {manifest.kind === 'plugin' ? (
          <p className="text-xs font-medium">
            {manifest.label} <span className="font-mono text-fg-mute">{manifest.id}@{manifest.version}</span>
          </p>
        ) : (
          <p className="text-xs font-medium font-mono">{manifest.bin}@{manifest.version}</p>
        )}
      </div>
      <p className="break-all font-mono text-[11px] text-fg-mute">
        {t('settings.extensions.install.source', { host: hostOf(sourceUrl) })}
      </p>

      {manifest.kind === 'plugin' ? (
        <>
          <p className="text-[11px] text-fg-mute">{manifest.description}</p>
          <Chips items={manifest.permissions} added={addedPermissions} />
          <Chips items={manifest.hosts} added={addedHosts} label={t('settings.extensions.install.hosts')} />
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
          <Chips items={Object.keys(manifest.targets)} added={new Set()} />
        </div>
      )}

      {replaced && (
        <Callout tone={downgrade || sourceChanged || addedPermissions.size + addedHosts.size > 0 ? 'warning' : 'info'} size="sm">
          <p>
            {t('settings.extensions.install.replaces', {
              version: replaced.manifest.version,
              host: hostOf(replaced.sourceUrl),
            })}
          </p>
          {downgrade && <p className="font-medium">{t('settings.extensions.install.downgrade')}</p>}
          {sourceChanged && <p className="font-medium">{t('settings.extensions.install.sourceChanged')}</p>}
          {addedPermissions.size + addedHosts.size > 0 && <p>{t('settings.extensions.install.addedAccess')}</p>}
          {replaced.kind === 'service' && <p>{t('settings.extensions.installed.serviceWarning')}</p>}
        </Callout>
      )}

      {children}
    </>
  );
}
