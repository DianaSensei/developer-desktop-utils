import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DropZoneProps {
  icon: LucideIcon;
  title: React.ReactNode;
  hint?: React.ReactNode;
  /** File types for the hidden web input (e.g. "image/*"). */
  accept?: string;
  /** Called with dropped/selected files (drop always fires this). */
  onFiles?: (files: FileList) => void;
  /**
   * Custom activation on click (e.g. open a Tauri native dialog). When set, it
   * runs instead of opening the hidden file input — but drops still call onFiles.
   */
  onActivate?: () => void;
  /** Extra content rendered below the title (e.g. a "paste from clipboard" button). */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Shared drag-and-drop / click-to-browse surface. Consolidates the dashed
 * upload zone hand-rolled in QR, Checksum, Image↔Base64 and 2FA into one
 * primitive with consistent drag-over highlight and the app's motion.
 */
export function DropZone({
  icon: Icon,
  title,
  hint,
  accept,
  onFiles,
  onActivate,
  children,
  className,
}: DropZoneProps) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const activate = () => {
    if (onActivate) onActivate();
    else inputRef.current?.click();
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files?.length && onFiles) onFiles(e.dataTransfer.files);
      }}
      onClick={activate}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center',
        'transition-[border-color,background-color] duration-200 ease-out',
        dragging
          ? 'border-primary bg-primary/5'
          : 'border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30',
        className
      )}
    >
      {onFiles && (
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); }}
        />
      )}
      <Icon className={cn('h-8 w-8 transition-colors', dragging ? 'text-primary' : 'text-muted-foreground/50')} />
      <div>
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
