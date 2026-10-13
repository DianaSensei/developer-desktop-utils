// Handles `desktop-devtool-app://install?manifest=<url>&service=<url>` links
// from the plugins web page and opens the install confirmation in Settings
// (see src-tauri/src/main.rs for scheme registration and pendingInstall.ts
// for the queue in between).
//
// Links can come from anywhere, so nothing is installed automatically: the
// user still reviews name, permissions and source and confirms.

import { isTauri } from '@/lib/platform';
import { pendingInstall } from '@/lib/pendingInstall';

/** Must match `plugins.deep-link.desktop.schemes` in tauri.conf.json.
 *  `desktop-devtool-app-canary` is a leftover from the retired canary
 *  channel and is still accepted. */
export const INSTALL_LINK_SCHEMES = ['desktop-devtool-app', 'desktop-devtool-app-canary'] as const;

/** Parses a URL into manifest URLs to install (plugin first, then service).
 *  Anything that is not an install link yields an empty list. */
export function parseInstallUrls(raw: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return [];
  }
  const scheme = parsed.protocol.slice(0, -1); // drop the trailing ':'
  if (!INSTALL_LINK_SCHEMES.includes(scheme as (typeof INSTALL_LINK_SCHEMES)[number]) || parsed.hostname !== 'install')
    return [];
  const urls: string[] = [];
  const manifest = parsed.searchParams.get('manifest');
  const service = parsed.searchParams.get('service');
  if (manifest) urls.push(manifest);
  if (service) urls.push(service);
  return urls;
}

let started = false;

/** The part of react-router's `useNavigate()` signature used here. */
type NavigateWithState = (path: string, options?: { state?: unknown }) => void;

/** Called once from App.tsx. No-op on the web and on repeat calls
 *  (StrictMode double mount). */
export async function initDeepLinkHandling(navigate: NavigateWithState): Promise<void> {
  if (!isTauri || started) return;
  started = true;

  const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');

  const handle = (urls: string[]) => {
    const toInstall = urls.flatMap(parseInstallUrls);
    if (toInstall.length === 0) return;
    pendingInstall.enqueue(toInstall);
    // Router state, not a query string: a one-time signal for this
    // navigation (Settings.tsx reads it).
    navigate('/settings', { state: { section: 'extensions' } });
  };

  // Cold start: the app was launched by this link.
  const current = await getCurrent();
  if (current) handle(current);

  // Already running: single-instance (main.rs) forwards the URL here.
  await onOpenUrl(handle);
}
