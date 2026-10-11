import { interpolate } from '@/lib/i18n';
import { currentLocale } from '@/contexts/LocaleContext';
import MESSAGES from './ApiClient.messages';

export type ApiMessageKey = keyof typeof MESSAGES;

/**
 * Dịch một khoá của API Client. Không phải hook — gọi được trong component
 * lồng sâu lẫn hàm thuần. Xem `currentLocale()` để biết vì sao an toàn.
 */
export function t(key: ApiMessageKey, params?: Record<string, string | number>): string {
  const entry = MESSAGES[key];
  return entry ? interpolate(entry[currentLocale()], params) : key;
}
