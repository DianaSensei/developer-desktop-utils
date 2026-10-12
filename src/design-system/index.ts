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
export { Checkbox, type CheckboxProps } from '@/components/ui/checkbox';
export { Skeleton, SkeletonText, SkeletonList, type SkeletonProps } from '@/components/ui/skeleton';
export {
  Dialog, DialogTrigger, DialogPortal, DialogClose, DialogOverlay, DialogContent,
  DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
export { ModalShell, type ModalShellProps } from '@/components/ui/modal-shell';
export { Tooltip, type TooltipProps } from '@/components/ui/tooltip';
export { Segmented, type SegmentedProps, type SegmentedOption } from '@/components/ui/segmented';
export { ToggleChip, type ToggleChipProps } from '@/components/ui/toggle-chip';
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

// Three status levels; pick by how much needs saying (design/COMPONENTS.md):
//   StatusChip     glanceable, no explanation        (panel header)
//   OutlineNotice  pending item with one action      (border only)
//   ExplainBand    explanation plus fixable examples (panel body)
// All three sit inside the panel, so valid ↔ error does not shift layout.
export { StatusChip, type StatusChipProps, type StatusChipTone } from '@/components/ui/status-chip';
export { OutlineNotice, type OutlineNoticeProps, type OutlineNoticeTone } from '@/components/ui/outline-notice';
export { ExplainBand, type ExplainBandProps, type ExplainBandTone, type ExplainBandExample } from '@/components/ui/explain-band';

// Rows:
//   ParamRow    displays a parameter (label · value · tag · explanation)
//   SettingRow  editable setting (icon · title · description · control)
export { ParamRow, type ParamRowProps } from '@/components/ui/param-row';
export { SettingRow, SettingGroup, type SettingRowProps } from '@/components/ui/setting-row';

// Input frame with at most two accessories inside the field.
export { FieldShell, type FieldShellProps } from '@/components/ui/field-shell';

// Keyboard shortcuts; <Button sc="⏎"> uses the inline variant.
export { Keycap, MOD_KEY, IS_MAC, type KeycapProps } from '@/components/ui/keycap';

// Data display
export {
  DataTable, Thead, Tbody, Tr, Th, Td,
  type DataTableProps, type DataTableDensity, type TheadProps, type TbodyProps,
  type TrProps, type ThProps, type TdProps,
} from '@/components/ui/data-table';

// Code editors: one component per language, each with only the features
// that fit (JSON uses `jsonParseLinter`; JS/SQL use a syntax-error-node
// linter). Pick by content rather than a `language` prop (see
// code-editor.tsx). CodeViewer is the read-only surface; InlineCodeField is
// the single-line {{variable}}-aware field for URL bars and key/value rows.
export {
  JsonEditor, JsonSyntaxEditor, JavaScriptEditor, SqlEditor, TextEditor,
  type CodeEditorProps, type JavaScriptEditorProps,
} from '@/components/ui/code-editor';
export { CodeViewer, type CodeViewerProps, type CodeViewerHandle } from '@/components/ui/code-viewer';
export { InlineCodeField, type InlineCodeFieldProps, type InlineCodeFieldHandle } from '@/components/ui/inline-code-field';

// Shared CodeMirror 6 theme, syntax palette, and the hook that follows the
// app's light/dark switch. Only for bespoke editors (e.g. SqlFormatter's
// SQL/Mongo switch); prefer the components above.
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
