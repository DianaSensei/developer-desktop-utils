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

// Data display
export {
  DataTable, Thead, Tbody, Tr, Th, Td,
  type DataTableProps, type TheadProps, type TrProps, type ThProps, type TdProps,
} from '@/components/ui/data-table';

// Layout scaffolding
export { ToolSection, ToolLabel, ToolHint, ToolContent, Field, type FieldProps } from '@/components/ui/tool-section';
export { ToolToolbar, ToolPanes, ToolPane, PaneHeader, type PaneHeaderProps } from '@/components/ui/tool-layout';

// Utilities
export { cn } from '@/lib/utils';
