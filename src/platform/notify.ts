/**
 * System notifications behind `sdk.notify`. In the desktop app they go through
 * tauri-plugin-notification (Notification Center / Action Center / libnotify);
 * the browser build uses the Web Notification API. Either way the OS asks the
 * user once, and a refusal makes every call resolve `false` so callers can
 * fall back to an in-app notice.
 */

import { isTauri } from '@/lib/platform';

export interface NotifyOptions {
  title: string;
  body?: string;
}

/** Resolves `true` when the notification was handed to the OS. */
export async function showSystemNotification({ title, body }: NotifyOptions): Promise<boolean> {
  try {
    if (isTauri) {
      const n = await import('@tauri-apps/plugin-notification');
      let granted = await n.isPermissionGranted();
      if (!granted) granted = (await n.requestPermission()) === 'granted';
      if (!granted) return false;
      n.sendNotification({ title, body });
      return true;
    }
    const WebNotification = globalThis.Notification;
    if (!WebNotification) return false;
    let permission = WebNotification.permission;
    if (permission === 'default') permission = await WebNotification.requestPermission();
    if (permission !== 'granted') return false;
    const shown = new WebNotification(title, { body });
    shown.onclick = () => globalThis.focus?.();
    return true;
  } catch {
    return false;
  }
}

/** Whether a notification would be shown without asking (`'default'` = not asked yet). */
export async function notificationPermission(): Promise<'granted' | 'denied' | 'default' | 'unsupported'> {
  try {
    if (isTauri) {
      const n = await import('@tauri-apps/plugin-notification');
      return (await n.isPermissionGranted()) ? 'granted' : 'default';
    }
    const WebNotification = globalThis.Notification;
    return WebNotification ? WebNotification.permission : 'unsupported';
  } catch {
    return 'unsupported';
  }
}
