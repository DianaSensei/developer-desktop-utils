import { useMemo } from 'react';
import { usePluginSdkOptional } from './context';
import { getPlugin } from './registry';
import { createPluginSdk, type PluginSdk } from './sdk';

/**
 * SDK của một plugin, lấy được kể cả khi component KHÔNG nằm trong cây mà
 * Platform dựng.
 *
 * Cần vì có code của plugin cố tình sống ngoài route của nó: API Client giữ một
 * instance store duy nhất ở `ApiClientRuntimeProvider`, mount thẳng trong
 * App.tsx để cầu nối MCP vẫn trả lời được khi người dùng đang xem tool khác.
 * Ở đó `usePluginSdk()` sẽ ném, dù đây vẫn đúng là code của plugin đó.
 *
 * Ưu tiên SDK trong context khi có và đúng plugin — giữ nguyên danh tính mà
 * Platform đã cấp; chỉ khi không có mới dựng từ manifest trong registry.
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
