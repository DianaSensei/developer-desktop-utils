import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

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

const DEFAULT_FEATURES: FeatureSettings = {
  'task-tracker': true,
  'api-client': true,
  'mock-server': true,
  'cron-generator': true,
  'text-transform': true,
  'text-counter': true,
  'color-picker': false,
  'base64': true,
  'unix-time': true,
  'json': true,
  'data-converter': true,
  'jwt': false,
  'regex': false,
  'diff': false,
  'qrcode': true,
  'markdown': false,
  'deduplicate': false,
  'generator': true,
  'kafka-explorer': false,
  'rabbit-client': false,
  'sql-formatter': false,
  'network': false,
  'lucky-wheel': false,
  '2fa': true,
  'settings': true,
};

export function FeatureProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<FeatureSettings>(() => {
    try {
      const saved = localStorage.getItem('devtool-features');
      if (!saved) return DEFAULT_FEATURES;
      // Merge: new tools get their DEFAULT value; existing user overrides are preserved
      return { ...DEFAULT_FEATURES, ...JSON.parse(saved) };
    } catch {
      return DEFAULT_FEATURES;
    }
  });

  const [toolOrder, setToolOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(TOOL_ORDER_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(FAVORITES_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem('devtool-features', JSON.stringify(features));
  }, [features]);

  const toggleFeature = (featureId: string) => {
    setFeatures((prev) => ({
      ...prev,
      [featureId]: !prev[featureId],
    }));
  };

  const isFeatureEnabled = (featureId: string) => {
    return features[featureId] !== false;
  };

  const resetToDefaults = () => {
    setFeatures(DEFAULT_FEATURES);
  };

  const reorderTools = (order: string[]) => {
    setToolOrder(order);
    localStorage.setItem(TOOL_ORDER_KEY, JSON.stringify(order));
  };

  // Most-recently-favorited goes first, so the top of the sidebar reflects the
  // order the user starred things.
  const toggleFavorite = (featureId: string) => {
    setFavorites((prev) =>
      prev.includes(featureId) ? prev.filter((id) => id !== featureId) : [featureId, ...prev]
    );
  };

  const isFavorite = (featureId: string) => favorites.includes(featureId);

  return (
    <FeatureContext.Provider value={{ features, toggleFeature, isFeatureEnabled, resetToDefaults, toolOrder, reorderTools, favorites, toggleFavorite, isFavorite }}>
      {children}
    </FeatureContext.Provider>
  );
}

export function useFeatures() {
  const context = useContext(FeatureContext);
  if (context === undefined) {
    throw new Error('useFeatures must be used within a FeatureProvider');
  }
  return context;
}
