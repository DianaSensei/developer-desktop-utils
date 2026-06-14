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
  'cron-generator': true,
  'text-transform': true,
  'text-counter': true,
  'color-picker': true,
  'base64': true,
  'hash': true,
  'unix-time': true,
  'json': true,
  'jwt': true,
  'regex': true,
  'diff': true,
  'qrcode': true,
  'markdown': true,
  'deduplicate': true,
  'checksum': true,
  'image-base64': true,
  'generator': true,
  'settings': true,
};

export function FeatureProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<FeatureSettings>(() => {
    const saved = localStorage.getItem('devtool-features');
    return saved ? JSON.parse(saved) : DEFAULT_FEATURES;
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
