import { Copy, Check } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCopyFeedback } from '@/hooks/useCopyFeedback';

interface CopyButtonProps extends Omit<ButtonProps, 'onClick'> {
  text: string;
  label?: string;
  showIcon?: boolean;
  feedbackDuration?: number;
}

export function CopyButton({
  text,
  label = 'Copy',
  showIcon = true,
  feedbackDuration = 2000,
  className,
  ...props
}: CopyButtonProps) {
  const { copied, copy } = useCopyFeedback(feedbackDuration);

  return (
    <Button
      onClick={() => copy(text)}
      className={cn(
        'transition-all duration-200',
        copied && 'bg-green-500 hover:bg-green-500 text-white'
      )}
      {...props}
    >
      {showIcon && (
        copied
          ? <Check className="h-4 w-4" />
          : <Copy className="h-4 w-4" />
      )}
      {label && <span className="ml-1">{copied ? 'Copied!' : label}</span>}
    </Button>
  );
}
