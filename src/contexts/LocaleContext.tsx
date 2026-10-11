import { createContext, useCallback, useContext, useState, useEffect, type ReactNode } from 'react';
import { storageGet, storageSet } from '@/lib/persistentStore';
import { translate, detectDefaultLocale, interpolate, type Locale, type Messages, type TranslationKey } from '@/lib/i18n';

const LOCALE_KEY = 'devtool-locale';

interface LocaleContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Dịch một khoá — xem `lib/i18n.ts` cho danh sách khoá và cú pháp `{{param}}`. */
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

/**
 * Ngôn ngữ hiện tại ở cấp module — cho code dịch KHÔNG qua hook (từ điển của
 * API Client: hàng chục component lồng nhau và cả hàm thuần cần chữ đã dịch).
 *
 * Chỉ an toàn vì ngôn ngữ chỉ đổi được trong Settings, là route riêng: mọi
 * tool đã unmount lúc đó và mount lại với giá trị mới. Component nằm cùng màn
 * hình với nơi đổi ngôn ngữ phải dùng `useLocale`/`useMessages`, không dùng cái này.
 */
let currentLocaleValue: Locale | null = null;
export function currentLocale(): Locale {
  return currentLocaleValue ?? 'en';
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = storageGet(LOCALE_KEY);
    return saved === 'vi' || saved === 'en' ? saved : detectDefaultLocale();
  });

  useEffect(() => {
    storageSet(LOCALE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  currentLocaleValue = locale;
  const t: LocaleContextType['t'] = (key, params) => translate(key, locale, params);

  return (
    <LocaleContext.Provider value={{ locale, setLocale: setLocaleState, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (context === undefined) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
}

/**
 * Hàm dịch cho từ điển RIÊNG của một tool (`<Tool>.messages.ts`):
 *
 *   const m = useMessages(MESSAGES);
 *   m('copy')  ·  m('matches', { n: 3 })
 *
 * Không ném khi nằm ngoài LocaleProvider (test render tool đơn lẻ, plugin cài
 * ngoài đọc qua vendor UI) — khi đó dùng tiếng Anh.
 */
export function useMessages<M extends Messages>(messages: M) {
  const locale = useContext(LocaleContext)?.locale ?? 'en';
  return useCallback(
    (key: keyof M & string, params?: Record<string, string | number>) =>
      interpolate(messages[key]?.[locale] ?? key, params),
    [messages, locale],
  );
}

/** Ngôn ngữ đang chọn, không ném khi nằm ngoài LocaleProvider (mặc định 'en'). */
export function useCurrentLocale(): Locale {
  return useContext(LocaleContext)?.locale ?? 'en';
}
