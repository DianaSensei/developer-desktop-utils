import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  type AppConfig,
  type ConfigField,
  CONFIG_FIELDS,
  DEFAULT_APP_CONFIG,
  mergeConfig,
} from '@/config/appConfig';

const STORAGE_KEY = 'devtool-app-config';

interface AppConfigContextValue {
  config: AppConfig;
  /** Update a single field by its section/key metadata. Value is clamped to the field's range. */
  setField: (field: ConfigField, value: number) => void;
  /** Restore all configuration to defaults. */
  resetConfig: () => void;
}

const AppConfigContext = createContext<AppConfigContextValue | null>(null);

function load(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return mergeConfig(raw ? JSON.parse(raw) : null);
  } catch {
    return mergeConfig(null);
  }
}

export function AppConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(load);

  const persist = useCallback((next: AppConfig) => {
    setConfig(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — keep in-memory value */
    }
  }, []);

  const setField = useCallback((field: ConfigField, value: number) => {
    const clamped = Math.min(field.max, Math.max(field.min, Math.round(value)));
    setConfig((prev) => {
      const next: AppConfig = {
        ...prev,
        [field.section]: { ...prev[field.section], [field.key]: clamped },
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const resetConfig = useCallback(() => {
    persist(structuredClone(DEFAULT_APP_CONFIG));
  }, [persist]);

  const value = useMemo<AppConfigContextValue>(
    () => ({ config, setField, resetConfig }),
    [config, setField, resetConfig]
  );

  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}

export function useAppConfig() {
  const ctx = useContext(AppConfigContext);
  if (!ctx) throw new Error('useAppConfig must be used within AppConfigProvider');
  return ctx;
}

export { CONFIG_FIELDS };
