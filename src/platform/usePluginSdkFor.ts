import { useMemo } from 'react';
import { usePluginSdkOptional } from './context';
import { getPlugin } from './registry';
import { createPluginSdk, type PluginSdk } from './sdk';

const cache = new Map<string, PluginSdk>();

/**
 * SDK của một plugin, lấy được NGOÀI React.
 *
 * Cần cho những store sống ở phạm vi module vì đó chính là lý do chúng tồn tại:
 * consumer Kafka/RabbitMQ phải chạy tiếp khi người dùng chuyển sang tool khác,
 * nên chúng không thể là state của component và vì thế không gọi hook được.
 *
 * Kết quả được nhớ theo id: SDK gắn danh tính plugin chứ không mang state gì,
 * nên một instance cho mỗi plugin là đủ — và giữ nguyên một tham chiếu giúp các
 * `useMemo([sdk])` phía trên không bị vô hiệu.
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
