import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { GenericGuide, TOOL_GUIDES } from '@/lib/toolGuides';

interface Props {
  toolId: string;
  label: string;
  description: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** True when opened automatically because the guide's content changed since the user last saw it. */
  isWhatsNew?: boolean;
}

// Single guide modal used for every tool: rich content when the tool has a
// dedicated guide in TOOL_GUIDES, otherwise a generic guide from its description.
export function ToolGuideModal({ toolId, label, description, open, onOpenChange, isWhatsNew }: Props) {
  const rich = TOOL_GUIDES[toolId];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isWhatsNew ? `Có gì mới ở ${label}` : `Using ${label}`}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {rich ?? <GenericGuide description={description} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
