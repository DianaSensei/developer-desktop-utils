import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Callout } from '@/components/ui/callout';

export interface MathConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
}

interface Challenge {
  question: string;
  answer: number;
}

function randomChallenge(): Challenge {
  const op = (['+', '−', '×'] as const)[Math.floor(Math.random() * 3)];
  if (op === '×') {
    const a = 2 + Math.floor(Math.random() * 9);
    const b = 2 + Math.floor(Math.random() * 9);
    return { question: `${a} × ${b}`, answer: a * b };
  }
  let a = 2 + Math.floor(Math.random() * 18);
  let b = 2 + Math.floor(Math.random() * 18);
  if (op === '−' && b > a) [a, b] = [b, a];
  return { question: `${a} ${op} ${b}`, answer: op === '+' ? a + b : a - b };
}

/**
 * Destructive-action confirm that requires solving a small arithmetic
 * challenge instead of a plain Cancel/Confirm click — for a key delete, where
 * a reflexive double-click on the usual dialog is easy to do without reading
 * the key name. A wrong answer draws a fresh challenge rather than just an
 * error, so it can't be defeated by repeating the last guess.
 */
export function MathConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = 'Delete', onConfirm,
}: MathConfirmDialogProps) {
  const [challenge, setChallenge] = useState<Challenge>(() => randomChallenge());
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setChallenge(randomChallenge());
      setInput('');
      setError(null);
    }
  }, [open]);

  const correct = input.trim() !== '' && Number(input) === challenge.answer;

  const handleConfirm = async () => {
    if (!correct) {
      setError('Not quite — try the new one.');
      setChallenge(randomChallenge());
      setInput('');
      return;
    }
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-xs text-fg-mute">Solve to confirm:</p>
          <div className="flex items-center gap-2">
            <span className="rounded-md border bg-bg-2/40 px-3 py-2 font-mono text-sm font-semibold">
              {challenge.question} =
            </span>
            <Input
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleConfirm(); }}
              placeholder="?"
              autoFocus
              inputMode="numeric"
              className="w-24 font-mono text-sm"
            />
          </div>
          {error && <Callout tone="error" size="sm">{error}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={busy || !correct}>
            {busy ? 'Deleting…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
