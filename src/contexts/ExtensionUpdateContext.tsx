import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { isTauri } from '@/lib/platform';
import { checkAllForUpdates, type ArtifactUpdateAvailable } from '@/platform';

// Auto-check for updates to externally-installed plugins/services (Settings →
// Extensions), mirroring UpdateContext's role for the app's own binary but
// simpler: no daily timer, no download/install flow here — checking each
// installed artifact's manifest is cheap (a JSON fetch, not a binary
// download), so one check per app launch is enough. The actual
// download+install step stays exactly where it already lived
// (SettingsExtensionInstaller.tsx's per-row "Update" button, calling
// installPlugin/installService) — this context only makes "there IS an
// update" known before the user opens Settings and clicks "Check for
// update" on every row by hand.

interface ExtensionUpdateContextValue {
  checking: boolean;
  /** Every installed plugin/service with a newer version at its own source URL. */
  updates: ArtifactUpdateAvailable[];
  /** Re-run the check (e.g. after installing/uninstalling something in Settings). */
  refresh: () => Promise<void>;
}

const ExtensionUpdateContext = createContext<ExtensionUpdateContextValue | null>(null);

export function ExtensionUpdateProvider({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(false);
  const [updates, setUpdates] = useState<ArtifactUpdateAvailable[]>([]);

  const refresh = useCallback(async () => {
    if (!isTauri) return;
    setChecking(true);
    try {
      setUpdates(await checkAllForUpdates());
    } finally {
      setChecking(false);
    }
  }, []);

  // Once per app launch — no interval/daily-boundary bookkeeping like
  // UpdateContext's binary updater: re-checking a plugin's manifest JSON on
  // every startup is negligible cost, unlike re-downloading the app itself.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <ExtensionUpdateContext.Provider value={{ checking, updates, refresh }}>
      {children}
    </ExtensionUpdateContext.Provider>
  );
}

export function useExtensionUpdates(): ExtensionUpdateContextValue {
  const ctx = useContext(ExtensionUpdateContext);
  if (!ctx) throw new Error('useExtensionUpdates must be used within an ExtensionUpdateProvider');
  return ctx;
}
