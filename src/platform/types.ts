import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { ServiceDescriptor } from './service';

/**
 * Hợp đồng giữa Platform và Plugin.
 *
 * Mỗi tool trong app là một PLUGIN: một thư mục `src/plugins/<id>/` có đúng một
 * file `plugin.ts` export default một `PluginManifest`. Platform tự quét thư mục
 * đó (xem `registry.ts`) — không có bảng đăng ký tay nào nữa.
 *
 * Trước file này, thêm một tool phải sửa 5 chỗ rời rạc (`toolDefs.ts`,
 * `DEFAULT_TOOL_ORDER`, `toolRegistry.ts`, `DEFAULT_FEATURES`, và route trong
 * App.tsx) — bốn trong năm chỗ đó không có gì bắt buộc phải khớp nhau, nên một
 * tool thiếu route chỉ lặng lẽ mất `path`/`component` lúc chạy. Manifest gom cả
 * năm về một nơi, và `registry.test.ts` khoá lại tính toàn vẹn.
 */

/** Version của Platform SDK. Plugin khai `sdk: '^1.0.0'` để chốt tương thích. */
export const SDK_VERSION = '1.0.0';

/**
 * Quyền một plugin phải khai báo trước khi dùng kênh tương ứng của SDK.
 *
 * Đây KHÔNG phải hàng rào bảo mật chống mã độc — mọi plugin hiện đều do chính
 * chúng ta phát hành và chạy chung realm với app, nên về kỹ thuật nó vẫn gọi
 * thẳng được `window.__TAURI_INTERNALS__`. Quyền ở đây phục vụ ba việc khác,
 * đều có giá trị thật: (1) khai báo tường minh để hiện cho người dùng thấy
 * plugin nào chạm vào cái gì, (2) bắt lỗi sớm khi một plugin dùng kênh nó chưa
 * khai, (3) cho `audit.ts` một nhãn để ghi nhật ký. Hàng rào thật chỉ xuất hiện
 * nếu sau này plugin chạy trong webview/tiến trình riêng — lúc đó danh sách này
 * chính là thứ ánh xạ sang capability của Tauri.
 */
export type PluginPermission =
  | 'storage'
  | 'secrets'
  | 'clipboard:read'
  | 'clipboard:write'
  | 'http'
  | 'native'
  | 'service';

export interface PluginManifest {
  /** kebab-case, duy nhất toàn app. Đồng thời là khoá bật/tắt và namespace storage. */
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /** Từ khoá đồng nghĩa cho ô tìm kiếm sidebar (vd "epoch" → Date/Time). */
  keywords?: string[];
  /**
   * Gắn nhãn "Experimental" ở mọi nơi plugin được liệt kê VÀ hỏi lại người dùng
   * mỗi lần mở (`ExperimentalGate`). Dành cho plugin còn đổi hành vi/backend,
   * không phải cho plugin mới nhưng đã ổn định.
   */
  experimental?: boolean;
  /** Route tuyệt đối, bắt đầu bằng "/". Duy nhất toàn app. */
  route: string;
  /** Vị trí mặc định trong sidebar khi cài mới. Nhỏ hơn = lên trước, duy nhất. */
  order: number;
  /** Trạng thái bật/tắt cho bản cài mới. Người dùng đổi được trong Settings. */
  defaultEnabled: boolean;
  /**
   * Bỏ lớp bọc cuộn sẵn của shell, plugin tự quản lý overflow. Mặc định `true`
   * — gần như mọi tool đều cần, và các layout `tool-full-height` giả định vậy.
   */
  fullHeight?: boolean;
  /** Kênh SDK plugin được phép dùng. Không khai = không được gọi. */
  permissions?: PluginPermission[];
  /**
   * Danh sách lệnh Tauri plugin được phép `invoke`, chỉ có nghĩa khi đã khai
   * quyền 'native'. Khớp tiền tố: `'redis_'` cho phép mọi lệnh `redis_*`.
   */
  commands?: string[];
  /**
   * Host plugin được phép gọi tới, chỉ có nghĩa khi đã khai quyền 'http'.
   * Dạng: `'dns.google'` (khớp đúng), `'*.example.com'` (chính nó và mọi
   * subdomain), hoặc `'*'` cho plugin thật sự không giới hạn được.
   *
   * `'*'` phải khai TƯỜNG MINH: một HTTP workbench đúng là gọi được mọi nơi
   * theo thiết kế, nhưng điều đó xứng đáng là một dòng nhìn thấy được trong
   * manifest chứ không phải mặc định ngầm của mọi plugin có quyền http.
   */
  hosts?: string[];
  /**
   * Tier B: sidecar plugin này cần. Khai `service` thì phải khai cả quyền
   * 'service' — xem `service.ts` cho hợp đồng và lý do chọn tiến trình riêng.
   */
  service?: ServiceDescriptor;
  /** Dải version SDK plugin chạy được, dạng `^M.m.p`. */
  sdk: string;
  /** Nạp component chính. Được gọi lazy ở lần điều hướng đầu tiên → code-split. */
  load: () => Promise<ComponentType>;
}

/** Manifest đã qua kiểm tra + các giá trị mặc định đã điền. */
export interface PluginRecord extends PluginManifest {
  keywords: string[];
  experimental: boolean;
  fullHeight: boolean;
  permissions: PluginPermission[];
  commands: string[];
  /** Component để router dựng: `load` đã bọc `lazy` + context của plugin. */
  component: ComponentType;
}

/** Một manifest hỏng bị loại khỏi registry, kèm lý do — `registry.test.ts` khoá rỗng. */
export interface PluginLoadError {
  /** Đường dẫn file manifest, để biết sửa ở đâu. */
  source: string;
  id?: string;
  reason: string;
}
