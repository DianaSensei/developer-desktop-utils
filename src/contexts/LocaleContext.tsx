import { createContext, useCallback, useContext, useState, useEffect, type ReactNode } from 'react';
import { storageGet, storageSet } from '@/lib/persistentStore';
import { translate, detectDefaultLocale, interpolate, type Locale, type Messages, type TranslationKey } from '@/lib/i18n';

const LOCALE_KEY = 'devtool-locale';

interface LocaleContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Translates a key; see lib/i18n.ts for keys and `{{param}}` syntax. */
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

/**
 * Current locale at module level, for code that translates outside hooks
 * (the API Client dictionary, used by nested components and pure functions).
 * Safe because the locale only changes in Settings, a separate route, so
 * tools remount with the new value. Components on the same screen as the
 * switch must use `useLocale`/`useMessages`.
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
 * Translator for a tool's own dictionary (`<Tool>.messages.ts`):
 *
 *   const m = useMessages(MESSAGES);
 *   m('copy')  ·  m('matches', { n: 3 })
 *
 * Falls back to English outside LocaleProvider (single-tool tests,
 * installed plugins using the vendor UI).
 */
export function useMessages<M extends Messages>(messages: M) {
  const locale = useContext(LocaleContext)?.locale ?? 'en';
  return useCallback(
    (key: keyof M & string, params?: Record<string, string | number>) =>
      interpolate(messages[key]?.[locale] ?? key, params),
    [messages, locale],
  );
}

/** Current locale; 'en' outside LocaleProvider. */
export function useCurrentLocale(): Locale {
  return useContext(LocaleContext)?.locale ?? 'en';
}
