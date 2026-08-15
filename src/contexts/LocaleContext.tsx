import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { storageGet, storageSet } from '@/lib/persistentStore';
import { translate, detectDefaultLocale, type Locale, type TranslationKey } from '@/lib/i18n';

const LOCALE_KEY = 'devtool-locale';

interface LocaleContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Dịch một khoá — xem `lib/i18n.ts` cho danh sách khoá và cú pháp `{{param}}`. */
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = storageGet(LOCALE_KEY);
    return saved === 'vi' || saved === 'en' ? saved : detectDefaultLocale();
  });

  useEffect(() => {
    storageSet(LOCALE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

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
