import { useEffect } from 'react';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { liveConnections } from '@/lib/liveConnections';
import { useMcpBackgroundBridge } from '@/hooks/useMcpBackgroundBridge';
import { MCP_TOOL_IDS, useMcpToolEnabled, type McpToolId } from '@/hooks/useMcpToolEnabled';
import type { AppConfig } from '@/config/appConfig';
import type { PluginSdk } from './sdk';

/**
 * Dịch vụ của Platform có hình dạng React.
 *
 * Chúng không nằm trong object `sdk` vì hook không thể là thuộc tính của một
 * object thường — nhưng về bản chất chúng vẫn là Platform, nên cùng nằm sau một
 * cửa: plugin import mọi thứ platform từ '@/platform', không phải nhớ cái nào ở
 * `contexts/`, cái nào ở `hooks/`, cái nào ở `lib/`.
 */

/**
 * Các con số tinh chỉnh của app (debounce editor, giới hạn generator, nhịp
 * kafka…). Chỉ ĐỌC: người dùng sửa chúng trong Settings, plugin không được tự ý
 * đổi cấu hình chung của app.
 */
export function usePluginConfig(): AppConfig {
  return useAppConfig().config;
}

/**
 * Đánh dấu plugin đang có kết nối sống — sidebar hiện chấm live.
 *
 * Id lấy từ SDK chứ không viết tay: năm chỗ gọi trước đây đều nhắc lại một chuỗi
 * literal ('redis-client', 'kafka-explorer'…), và một chuỗi như thế lệch khỏi id
 * trong manifest thì chấm live đơn giản là không bao giờ sáng, không có lỗi nào
 * báo ra.
 *
 * CỐ Ý không dọn cờ lúc unmount: kết nối sống ở phía Rust, không phải ở
 * component. Người dùng chuyển sang tool khác thì kết nối vẫn còn, nên chấm live
 * phải còn — tắt nó lúc unmount sẽ là báo sai.
 */
export function useLiveConnection(sdk: PluginSdk, connected: boolean): void {
  useEffect(() => {
    liveConnections.set(sdk.id, connected);
  }, [sdk.id, connected]);
}

/**
 * Component này có nên tự gắn cầu nối MCP của nó không.
 *
 * Gộp ba điều kiện mà trước đây mỗi tool tự ghép lại: tool có mặt trong danh
 * sách MCP, công tắc riêng của tool đang bật, và bridge chạy nền đang TẮT. Vế
 * cuối là vế dễ sai nhất — khi bridge nền bật, `McpBackgroundBridge` đã gắn
 * bridge ở cấp app rồi, nên tool gắn thêm lần nữa là đăng ký trùng.
 */
export function usePluginMcpBridgeActive(sdk: PluginSdk): boolean {
  const { enabled: backgroundEnabled } = useMcpBackgroundBridge();
  const { enabled: toolEnabled } = useMcpToolEnabled(sdk.id as McpToolId);
  const isMcpTool = MCP_TOOL_IDS.includes(sdk.id as McpToolId);
  return isMcpTool && toolEnabled && !backgroundEnabled;
}
