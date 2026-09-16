import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
 * Bật/tắt mặc định cho bản cài mới, đọc từ `defaultEnabled` của từng manifest
 * plugin. `settings` được nối thêm vì nó là màn hình của shell, không phải
 * plugin, và không bao giờ tắt được.
 *
 * `FeatureProvider` trộn giá trị đã lưu LÊN TRÊN bảng này, nên một plugin mới
 * xuất hiện sẽ nhận đúng mặc định của nó thay vì thừa hưởng lựa chọn cũ của
 * người dùng cho một tool khác.
 */
const DEFAULT_FEATURES: FeatureSettings = {
  ...DEFAULT_PLUGIN_FEATURES,
  settings: true,
};

export function FeatureProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<FeatureSettings>(() => {
    try {
      const saved = storageGet('devtool-features');
      if (!saved) return DEFAULT_FEATURES;
      // Merge: new tools get their DEFAULT value; existing user overrides are preserved
      return { ...DEFAULT_FEATURES, ...JSON.parse(saved) };
    } catch {
      return DEFAULT_FEATURES;
    }
  });

  const [toolOrder, setToolOrder] = useState<string[]>(() => {
    try {
      const saved = storageGet(TOOL_ORDER_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = storageGet(FAVORITES_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  useEffect(() => {
    storageSet(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    storageSet('devtool-features', JSON.stringify(features));
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
    storageSet(TOOL_ORDER_KEY, JSON.stringify(order));
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
