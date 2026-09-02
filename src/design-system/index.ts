/**
 * DevTool Design System — single import surface.
 *
 *   import { Button, Card, Segmented, ToolToolbar, cn } from '@/design-system';
 *
 * Pairs with `tokens.css` (CSS variables + utilities) and
 * `tailwind-preset.cjs` (Tailwind theme). See README.md for reuse steps.
 */

// Primitives
export { Button, buttonVariants, type ButtonProps } from '@/components/ui/button';
export {
  Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card';
export { Input, type InputProps } from '@/components/ui/input';
export { Textarea, type TextareaProps } from '@/components/ui/textarea';
export { Label } from '@/components/ui/label';
export {
  Select, SelectGroup, SelectValue, SelectTrigger, SelectContent,
  SelectLabel, SelectItem, SelectSeparator, SelectScrollUpButton, SelectScrollDownButton,
} from '@/components/ui/select';
export { Switch, type SwitchProps } from '@/components/ui/switch';
export {
  Dialog, DialogTrigger, DialogPortal, DialogClose, DialogOverlay, DialogContent,
  DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
export { ModalShell, type ModalShellProps } from '@/components/ui/modal-shell';
export { Tooltip, type TooltipProps } from '@/components/ui/tooltip';
export { Segmented, type SegmentedProps, type SegmentedOption } from '@/components/ui/segmented';
export { CopyButton, type CopyButtonProps } from '@/components/ui/copy-button';
export { EmptyState } from '@/components/ui/empty-state';
export { DropZone, type DropZoneProps } from '@/components/ui/drop-zone';
export { IconButton, type IconButtonProps } from '@/components/ui/icon-button';
export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
  type DropdownMenuProps, type DropdownMenuTriggerProps, type DropdownMenuContentProps, type DropdownMenuItemProps,
} from '@/components/ui/dropdown-menu';
export { SplitPane, type SplitPaneProps, type SplitPaneDirection } from '@/components/ui/split-pane';
export { StatusDot, type StatusDotProps, type StatusDotTone } from '@/components/ui/status-dot';
export {
  ContextMenu, useContextMenu,
  type ContextMenuProps, type ContextMenuEntry, type ContextMenuState,
} from '@/components/ui/context-menu';
export { ConfirmDialog, type ConfirmDialogProps } from '@/components/ui/confirm-dialog';
export { SearchInput, type SearchInputProps } from '@/components/ui/search-input';
export { Tabs, type TabsProps, type TabDef } from '@/components/ui/tabs';
export { Callout, type CalloutProps, type CalloutTone } from '@/components/ui/callout';
export { Badge, type BadgeProps, type BadgeTone, type BadgeVariant } from '@/components/ui/badge';
export { Spinner, LoadingRow, type SpinnerProps, type LoadingRowProps } from '@/components/ui/spinner';
export { SectionLabel, type SectionLabelProps } from '@/components/ui/section-label';
export { CollapsibleSection, type CollapsibleSectionProps } from '@/components/ui/collapsible-section';
export { Stat, StatGrid, type StatProps, type StatGridProps, type StatTone, type StatVariant } from '@/components/ui/stat';

// Hệ trạng thái ba bậc — chọn bậc theo mức độ cần nói, xem design/COMPONENTS.md:
//   StatusChip     liếc là thấy, không giải thích        (thanh tiêu đề panel)
//   OutlineNotice  việc đang chờ, kèm một hành động      (chỉ viền, không nền)
//   ExplainBand    cần giải thích + ví dụ sửa được       (trong thân panel)
// Cả ba nằm TRONG panel, nên chuyển hợp lệ ↔ lỗi không làm layout nhảy — đó là
// lý do chúng tồn tại thay vì một thẻ cảnh báo rời.
export { StatusChip, type StatusChipProps, type StatusChipTone } from '@/components/ui/status-chip';
export { OutlineNotice, type OutlineNoticeProps, type OutlineNoticeTone } from '@/components/ui/outline-notice';
export { ExplainBand, type ExplainBandProps, type ExplainBandTone, type ExplainBandExample } from '@/components/ui/explain-band';

// Dòng — hai công thức, hai mục đích khác nhau:
//   ParamRow    hiển thị tham số (nhãn · giá trị · tag · giải thích)
//   SettingRow  cấu hình sửa được (icon · tiêu đề · mô tả · điều khiển)
export { ParamRow, type ParamRowProps } from '@/components/ui/param-row';
export { SettingRow, SettingGroup, type SettingRowProps } from '@/components/ui/setting-row';

// Khung ô nhập — ép quy tắc tối đa hai phụ kiện trong ô.
export { FieldShell, type FieldShellProps } from '@/components/ui/field-shell';

// Phím tắt. <Button sc="⏎"> dùng bản nội tuyến của chính component này.
export { Keycap, MOD_KEY, IS_MAC, type KeycapProps } from '@/components/ui/keycap';

// Data display
export {
  DataTable, Thead, Tbody, Tr, Th, Td,
  type DataTableProps, type DataTableDensity, type TheadProps, type TbodyProps,
  type TrProps, type ThProps, type TdProps,
} from '@/components/ui/data-table';

// Code editors — one purpose-built component per language, each with only
// the features that make sense for it (JSON gets `jsonParseLinter`'s precise
// whole-document check; JS/SQL get the cheaper syntax-error-node linter, since
// neither has a real linter package). Pick the one matching your content
// instead of a `language` prop — see code-editor.tsx for why. CodeViewer is
// the one read-only surface (display-only, so no per-language behavior to
// gate). InlineCodeField is the single-line {{variable}}-aware field (URL
// bars, key/value rows) — not a "code editor" in this sense, no grammar, no
// multi-line.
export {
  JsonEditor, JsonSyntaxEditor, JavaScriptEditor, SqlEditor, TextEditor,
  type CodeEditorProps, type JavaScriptEditorProps,
} from '@/components/ui/code-editor';
export { CodeViewer, type CodeViewerProps, type CodeViewerHandle } from '@/components/ui/code-viewer';
export { InlineCodeField, type InlineCodeFieldProps, type InlineCodeFieldHandle } from '@/components/ui/inline-code-field';

// Code theme — the shared CodeMirror 6 look (theme, syntax palette, and the
// hook that keeps a live editor in step with the app's light/dark switch).
// Low-level: only reach for this building a bespoke editor (see
// SqlFormatter's runtime SQL↔Mongo language switch) — everything else should
// use the components above instead.
export {
  codeTheme, codeThemeWithHighlight, codeHighlight, useCodeTheme, smartBracketSkip, CODE_FONT,
  type CodeThemeOptions,
} from '@/components/ui/code-theme';
export { syntaxErrorLinter } from '@/components/ui/syntax-lint';

// Layout scaffolding
export { ToolSection, ToolLabel, ToolHint, ToolContent, Field, type FieldProps } from '@/components/ui/tool-section';
export { ToolToolbar, ToolPanes, ToolPane, PaneHeader, type PaneHeaderProps } from '@/components/ui/tool-layout';

// Utilities
export { cn } from '@/lib/utils';
