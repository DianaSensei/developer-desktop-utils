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
}

const TOOL_ORDER_KEY = 'devtool-tool-order';

const FeatureContext = createContext<FeatureContextType | undefined>(undefined);

const DEFAULT_FEATURES: FeatureSettings = {
  'task-tracker': true,
  'api-client': true,
  'cron-generator': true,
  'text-transform': true,
  'text-counter': true,
  'color-picker': false,
  'base64': true,
  'unix-time': true,
  'json': true,
  'jwt': false,
  'regex': false,
  'diff': false,
  'qrcode': true,
  'markdown': false,
  'deduplicate': false,
  'checksum': true,
  'image-base64': false,
  'generator': false,
  'kafka-explorer': false,
  'sql-formatter': false,
  'network': false,
  'meeting-notes': false,
  'lucky-wheel': false,
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

  return (
    <FeatureContext.Provider value={{ features, toggleFeature, isFeatureEnabled, resetToDefaults, toolOrder, reorderTools }}>
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
