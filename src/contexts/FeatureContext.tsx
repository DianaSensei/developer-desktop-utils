import { createContext, useCallback, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { storageGet, storageSet } from '@/lib/persistentStore';
import { DEFAULT_PLUGIN_FEATURES } from '@/platform';

interface FeatureSettings {
  [key: string]: boolean;
}

interface FeatureContextType {
  features: FeatureSettings;
  toggleFeature: (featureId: string) => void;
  isFeatureEnabled: (featureId: string) => boolean;
  resetToDefaults: () => void;
  toolOrder: string[];
  reorderTools: (order: string[]) => void;
  favorites: string[];
  toggleFavorite: (featureId: string) => void;
  isFavorite: (featureId: string) => boolean;
}

const TOOL_ORDER_KEY = 'devtool-tool-order';
const FAVORITES_KEY = 'devtool-favorites';

const FeatureContext = createContext<FeatureContextType | undefined>(undefined);

/**
 * Default enabled state for new installs, from each manifest's
 * `defaultEnabled`, plus `settings` (shell screen, always on). Stored values
 * are merged over this, so a new plugin gets its own default.
 */
const DEFAULT_FEATURES: FeatureSettings = {
  ...DEFAULT_PLUGIN_FEATURES,
  settings: true,
};

/**
 * Tools folded into another one: their id → the tool that now hosts them
 * (JWT Debugger became the JWT tab of Encode·Hash·Encrypt). Someone who had
 * the old tool on or starred keeps the host on or starred.
 */
const MERGED_INTO: Record<string, string> = { jwt: 'base64' };

function migrateMergedFeatures(saved: FeatureSettings): FeatureSettings {
  const next = { ...saved };
  for (const [from, to] of Object.entries(MERGED_INTO)) {
    if (!(from in next)) continue;
    if (next[from]) next[to] = true;
    delete next[from];
  }
  return next;
}

function migrateMergedIds(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const mapped = MERGED_INTO[id] ?? id;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

export function FeatureProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<FeatureSettings>(() => {
    try {
      const saved = storageGet('devtool-features');
      if (!saved) return DEFAULT_FEATURES;
      // New tools get their default; existing user choices are kept.
      return { ...DEFAULT_FEATURES, ...migrateMergedFeatures(JSON.parse(saved)) };
    } catch {
      return DEFAULT_FEATURES;
    }
  });

  const [toolOrder, setToolOrder] = useState<string[]>(() => {
    try {
      const saved = storageGet(TOOL_ORDER_KEY);
      return saved ? migrateMergedIds(JSON.parse(saved)) : [];
    } catch { return []; }
  });

  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = storageGet(FAVORITES_KEY);
      return saved ? migrateMergedIds(JSON.parse(saved)) : [];
    } catch { return []; }
  });

  useEffect(() => {
    storageSet(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    storageSet('devtool-features', JSON.stringify(features));
  }, [features]);

  const toggleFeature = useCallback((featureId: string) => {
    setFeatures((prev) => ({
      ...prev,
      [featureId]: !prev[featureId],
    }));
  }, []);

  const isFeatureEnabled = useCallback(
    (featureId: string) => features[featureId] !== false,
    [features]
  );

  const resetToDefaults = useCallback(() => {
    setFeatures(DEFAULT_FEATURES);
  }, []);

  const reorderTools = useCallback((order: string[]) => {
    setToolOrder(order);
    storageSet(TOOL_ORDER_KEY, JSON.stringify(order));
  }, []);

  // Most recently favorited first.
  const toggleFavorite = useCallback((featureId: string) => {
    setFavorites((prev) =>
      prev.includes(featureId) ? prev.filter((id) => id !== featureId) : [featureId, ...prev]
    );
  }, []);

  const isFavorite = useCallback((featureId: string) => favorites.includes(featureId), [favorites]);

  // Memoized so unrelated re-renders of this provider do not hand every
  // consumer a new value. Real changes still re-render all consumers.
  const value = useMemo<FeatureContextType>(
    () => ({
      features,
      toggleFeature,
      isFeatureEnabled,
      resetToDefaults,
      toolOrder,
      reorderTools,
      favorites,
      toggleFavorite,
      isFavorite,
    }),
    [features, toggleFeature, isFeatureEnabled, resetToDefaults, toolOrder, reorderTools, favorites, toggleFavorite, isFavorite]
  );

  return <FeatureContext.Provider value={value}>{children}</FeatureContext.Provider>;
}

export function useFeatures() {
  const context = useContext(FeatureContext);
  if (context === undefined) {
    throw new Error('useFeatures must be used within a FeatureProvider');
  }
  return context;
}
