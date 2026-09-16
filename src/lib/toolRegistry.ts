import { lazy, type ComponentType } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { PLUGINS } from '@/platform';

/**
 * Bảng route của app, dẫn xuất từ registry của Platform.
 *
 * Trước đây đây là hai bảng khai tay song song (`TOOL_DEFS` ↔ `TOOL_ROUTES`) mà
 * không gì bắt phải khớp nhau: một tool thiếu route chỉ lặng lẽ mất
 * `path`/`component` lúc chạy chứ không báo lỗi lúc build. Giờ cả hai đọc từ
 * cùng một manifest nên sai lệch đó không còn tồn tại được nữa.
 *
 * Settings không phải plugin: nó là màn hình của chính shell (quản lý plugin,
 * quyền, giao diện), luôn bật, và không bao giờ nằm trong danh sách bật/tắt —
 * nên nó được nối thêm ở đây thay vì có manifest riêng.
 */
const Settings = lazy(() => import('@/components/Settings').then((m) => ({ default: m.Settings })));

export const TOOL_ROUTES: Record<string, { path: string; component: ComponentType; fullHeight?: boolean }> =
  Object.fromEntries(
    PLUGINS.map((p) => [p.id, { path: p.route, component: p.component, fullHeight: p.fullHeight }]),
  );

export const allTools = [
  ...PLUGINS.map((p) => ({
    featureId: p.id,
    label: p.label,
    icon: p.icon,
    description: p.description,
    keywords: p.keywords,
    experimental: p.experimental,
    path: p.route,
    component: p.component,
    fullHeight: p.fullHeight,
  })),
  // fullHeight: Settings tự quản lý layout hai cột (nav trái · nội dung phải,
  // xem Settings.tsx), mỗi cột cuộn riêng — cần chiếm trọn khung hình như
  // API Client, không phải khối nội dung được bọc sẵn max-width + padding.
  { featureId: 'settings', label: 'Settings', icon: SettingsIcon, description: '', keywords: [], experimental: false, path: '/settings', component: Settings as ComponentType, fullHeight: true },
];

/** id tool → đường dẫn route. Bao gồm cả 'settings', không có trong TOOL_DEFS. */
export const TOOL_PATHS = new Map(allTools.map((t) => [t.featureId, t.path]));

export function toolPath(id: string): string {
  return TOOL_PATHS.get(id) ?? '/';
}
