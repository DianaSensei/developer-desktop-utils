// Shared confirm modal for destructive/irreversible actions (Delete, Remove,
// Purge, Disconnect-and-lose-state...). Promoted from RabbitMQ's local copy —
// every tool with a destructive action should use this instead of acting
// immediately or writing its own dialog, per the design system's "confirm
// destructive actions" rule.

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  /** Destructive styling (red confirm button). Default true. */
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
}

export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = 'Confirm', destructive = true, onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      // Trước đây lỗi từ `onConfirm` không được bắt: hộp thoại đứng nguyên, nút
      // quay về trạng thái bấm được, và người dùng không có cách nào biết thao
      // tác đã hỏng (lời hứa bị từ chối chỉ hiện ở console như unhandled
      // rejection). Xoá queue / xoá key / ngắt kết nối hỏng vì mất mạng là
      // đúng kịch bản này. Giữ hộp thoại mở CÓ CHỦ Ý — để còn bấm thử lại.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Mỗi lần đóng/mở lại thì bỏ lỗi cũ, không để nó dính sang lần xác nhận sau.
  const handleOpenChange = (o: boolean) => {
    if (busy) return;
    if (!o) setError(null);
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error && <Callout tone="error" size="sm">{error}</Callout>}
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={handleConfirm} disabled={busy}>
            {busy ? 'Working…' : error ? 'Retry' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
