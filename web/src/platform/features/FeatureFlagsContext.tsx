import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { ALL_FEATURES_ENABLED, type FeatureFlagKey, type FeatureFlagMap } from './catalog.js';
import { fetchEffectiveFeatures, type FeatureAdminGates } from './feature-api.js';

interface FeatureFlagsContextValue {
  flags: FeatureFlagMap;
  admin: FeatureAdminGates;
  loading: boolean;
  refresh: () => Promise<void>;
  isEnabled: (key: FeatureFlagKey) => boolean;
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue | null>(null);

const DEFAULT_ADMIN: FeatureAdminGates = { uiEnabled: false, apiEnabled: false };

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<FeatureFlagMap>(ALL_FEATURES_ENABLED);
  const [admin, setAdmin] = useState<FeatureAdminGates>(DEFAULT_ADMIN);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchEffectiveFeatures();
      setFlags({
        ...ALL_FEATURES_ENABLED,
        ...(data.flags as Partial<FeatureFlagMap>)
      });
      setAdmin(data.admin);
    } catch {
      setFlags(ALL_FEATURES_ENABLED);
      setAdmin(DEFAULT_ADMIN);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<FeatureFlagsContextValue>(
    () => ({
      flags,
      admin,
      loading,
      refresh,
      isEnabled: (key) => flags[key] !== false
    }),
    [admin, flags, loading, refresh]
  );

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
}

const FALLBACK_CONTEXT: FeatureFlagsContextValue = {
  flags: ALL_FEATURES_ENABLED,
  admin: DEFAULT_ADMIN,
  loading: false,
  refresh: async () => undefined,
  isEnabled: (key) => ALL_FEATURES_ENABLED[key] !== false
};

/** Falls back to all product flags enabled when rendered outside the provider (unit tests). */
export function useFeatureFlags(): FeatureFlagsContextValue {
  return useContext(FeatureFlagsContext) ?? FALLBACK_CONTEXT;
}

export function useFeatureEnabled(key: FeatureFlagKey): boolean {
  return useFeatureFlags().isEnabled(key);
}
