// The method + URL + Send bar. It spans the full width above the request/response
// split (Bruno layout), so both panes sit beneath one shared address bar.

import { Code2, Send, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { methodColor } from './method-color';
import { VarInput } from './VarInput';
import { type ApiRequest, HTTP_METHODS } from './types';

interface Props {
  request: ApiRequest;
  onChange: (patch: Partial<ApiRequest>) => void;
  onSend: () => void;
  onCancel: () => void;
  sending: boolean;
  onGenerateCode: () => void;
  vars: string[];
}

export function AddressBar({ request, onChange, onSend, onCancel, sending, onGenerateCode, vars }: Props) {
  return (
    <div className="p-3">
      <div className="flex items-center rounded-md border bg-background shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring/40">
        <Select value={request.method} onValueChange={(v) => onChange({ method: v as ApiRequest['method'] })}>
          <SelectTrigger className={cn('h-9 w-[6.5rem] shrink-0 border-0 bg-transparent font-bold shadow-none focus:ring-0', methodColor(request.method))}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HTTP_METHODS.map((m) => (
              <SelectItem key={m} value={m}><span className={cn('font-bold', methodColor(m))}>{m}</span></SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="h-5 w-px shrink-0 bg-border" />
        <div className="flex h-9 min-w-0 flex-1 items-center px-2.5">
          <VarInput
            value={request.url}
            onChange={(url) => onChange({ url })}
            vars={vars}
            onEnter={onSend}
            placeholder="https://api.example.com/endpoint  ·  {{var}} for environment values"
          />
        </div>
        <button
          onClick={onGenerateCode}
          title="Generate Code"
          className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Code2 className="h-4 w-4" />
        </button>
        {sending ? (
          <Button variant="destructive" size="sm" onClick={onCancel} className="m-1 h-7 gap-1.5">
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onSend}
            disabled={!request.url.trim()}
            className="m-1 h-7 gap-1.5 bg-amber-400 text-neutral-900 shadow-sm hover:bg-amber-500"
          >
            <Send className="h-3.5 w-3.5" /> Send
          </Button>
        )}
      </div>
    </div>
  );
}
