import { interpolate } from '@/lib/i18n';
import { currentLocale } from '@/contexts/LocaleContext';
import MESSAGES from './ApiClient.messages';

export type ApiMessageKey = keyof typeof MESSAGES;

/**
 * Translates an API Client key. Not a hook, so it works in nested components
 * and pure functions; see `currentLocale()` for why that is safe.
 */
export function t(key: ApiMessageKey, params?: Record<string, string | number>): string {
  const entry = MESSAGES[key];
  return entry ? interpolate(entry[currentLocale()], params) : key;
}
