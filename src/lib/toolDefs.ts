import type { LucideIcon } from 'lucide-react';
import { DEFAULT_PLUGIN_ORDER, PLUGINS } from '@/platform';

/**
 * Metadata tool cho sidebar, Settings và ô tìm kiếm.
 *
 * KHÔNG còn là nơi khai báo: từ khi có Platform, nguồn sự thật là manifest của
 * từng plugin (`src/plugins/<id>/plugin.ts`) và file này chỉ là một VIEW đọc
 * ra từ registry. Thêm tool = thêm một thư mục plugin, không sửa file này.
 *
 * Giữ lại `TOOL_DEFS` / `TOOL_DEF_MAP` / `DEFAULT_TOOL_ORDER` vì hơn một tá
 * module đã đọc theo hình dạng này (Settings, CommandPalette, toolGroups,
 * onboarding…); đổi chúng cùng lúc với việc đổi mô hình đăng ký sẽ trộn hai
 * thay đổi không liên quan vào một diff.
 */
export interface ToolDef {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /**
   * Extra search terms / synonyms so the sidebar search finds a tool even when
   * the user types a related word that isn't in its label or description
   * (e.g. "epoch" → Date/Time, "guid" → Generator, "postman" → API Client).
   */
  keywords?: string[];
  /**
   * Marks the tool as experimental: it gets a visible "Experimental" badge
   * everywhere it's listed (sidebar, Settings, the app titlebar) and — unlike
   * every other flag here — re-asks the user to confirm on EVERY visit, not
   * just once, via `ExperimentalGate` in App.tsx's route rendering. Reach for
   * this for a tool whose backend/behavior is still likely to change (new
   * runtime integrations, anything shelling out, unreviewed data-loss risk)
   * rather than one that's merely new but already stable.
   */
  experimental?: boolean;
}

export const TOOL_DEFS: ToolDef[] = PLUGINS.map((p) => ({
  id: p.id,
  label: p.label,
  icon: p.icon,
  description: p.description,
  // Giữ đúng tính "không khai thì vắng mặt" của hình dạng cũ: `keywords: []`
  // và `experimental: false` là hai giá trị KHÁC với không khai báo, và có test
  // đang phân biệt chúng.
  ...(p.keywords.length > 0 ? { keywords: p.keywords } : {}),
  ...(p.experimental ? { experimental: true } : {}),
}));

export const TOOL_DEF_MAP = new Map(TOOL_DEFS.map((t) => [t.id, t]));

/**
 * Thứ tự hiển thị mặc định cho bản cài mới (trước khi người dùng kéo-thả).
 * Đổi thứ tự = đổi trường `order` trong manifest của plugin.
 */
export const DEFAULT_TOOL_ORDER: string[] = [...DEFAULT_PLUGIN_ORDER];
