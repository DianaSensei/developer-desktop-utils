import { useMemo } from 'react';
import { usePluginSdkOptional } from './context';
import { getPlugin } from './registry';
import { createPluginSdk, type PluginSdk } from './sdk';

const cache = new Map<string, PluginSdk>();

/**
 * A plugin's SDK outside React, for module-scope stores that must keep
 * running when the user switches tools. Cached per id so references stay
 * stable. Lookup by id alone is unambiguous because installer.ts keeps ids
 * unique across groups.
 */
export function getPluginSdk(pluginId: string): PluginSdk {
  const existing = cache.get(pluginId);
  if (existing) return existing;

  const manifest = getPlugin(pluginId);
  if (!manifest) {
    throw new Error(
      `Không có plugin "${pluginId}" trong registry. getPluginSdk() chỉ dùng cho code ` +
        `thuộc một plugin có thật, không phải cho shell.`,
    );
  }
  const sdk = createPluginSdk(manifest);
  cache.set(pluginId, sdk);
  return sdk;
}

/**
 * A plugin's SDK for components rendered outside the plugin's route (e.g.
 * the API Client runtime provider mounted in App.tsx so MCP calls work from
 * any screen). Prefers the SDK from context when it belongs to this plugin.
 */
export function usePluginSdkFor(pluginId: string): PluginSdk {
  const fromContext = usePluginSdkOptional();
  return useMemo(() => {
    if (fromContext?.id === pluginId) return fromContext;
    const manifest = getPlugin(pluginId);
    if (!manifest) {
      throw new Error(
        `Không có plugin "${pluginId}" trong registry. usePluginSdkFor() chỉ dùng cho code ` +
          `thuộc một plugin có thật, không phải cho shell.`,
      );
    }
    return createPluginSdk(manifest);
  }, [fromContext, pluginId]);
}
