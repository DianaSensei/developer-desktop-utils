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

// Layout scaffolding
export { ToolSection, ToolLabel, ToolHint, ToolContent } from '@/components/ui/tool-section';
export { ToolToolbar, ToolPanes, ToolPane, PaneHeader, type PaneHeaderProps } from '@/components/ui/tool-layout';

// Utilities
export { cn } from '@/lib/utils';
