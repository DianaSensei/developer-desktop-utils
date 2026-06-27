// The method + URL + Send bar. It spans the full width above the request/response
// split (Bruno layout), so both panes sit beneath one shared address bar.

import { Code2, Send, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { methodBg, methodColor } from './method-color';
import { VarInput } from './VarInput';
import { paramsFromUrl } from './request';
import { type ApiRequest, HTTP_METHODS } from './types';

interface Props {
  request: ApiRequest;
  onChange: (patch: Partial<ApiRequest>) => void;
  onSend: () => void;
  onCancel: () => void;
  sending: boolean;
  onGenerateCode: () => void;
  vars: Record<string, string>;
}

export function AddressBar({ request, onChange, onSend, onCancel, sending, onGenerateCode, vars }: Props) {
  // Typing in the URL keeps the Params table in sync. Ignore echoes where the
  // value is unchanged (e.g. when a params edit rewrote the URL).
  const handleUrl = (url: string) => {
    if (url === request.url) return;
    onChange({ url, params: paramsFromUrl(url, request.params) });
  };

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center overflow-hidden rounded-lg border border-border bg-background shadow-sm transition-shadow focus-within:shadow-none focus-within:ring-2 focus-within:ring-ring/40">
        {/* Method selector — tinted to match the active HTTP method (Bruno-style) */}
        <Select value={request.method} onValueChange={(v) => onChange({ method: v as ApiRequest['method'] })}>
          <SelectTrigger
            className={cn(
              'h-9 w-[6.5rem] shrink-0 border-0 font-bold shadow-none focus:ring-0 rounded-r-none',
              methodColor(request.method),
              methodBg(request.method),
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HTTP_METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                <span className={cn('font-bold', methodColor(m))}>{m}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Divider between method and URL */}
        <span className="h-5 w-px shrink-0 bg-border" />

        <div className="flex h-9 min-w-0 flex-1 items-center px-3">
          <VarInput
            value={request.url}
            onChange={handleUrl}
            vars={vars}
            onEnter={onSend}
            placeholder="https://api.example.com/users/{{id}}"
          />
        </div>

        {/* Code generator */}
        <button
          onClick={onGenerateCode}
          title="Generate Code"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Code2 className="h-4 w-4" />
        </button>

        {/* Send / Cancel */}
        {sending ? (
          <Button variant="destructive" size="sm" onClick={onCancel} className="m-1 h-8 gap-1.5 rounded-lg">
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onSend}
            disabled={!request.url.trim()}
            className="m-1 h-8 gap-1.5 rounded-lg bg-amber-400 text-neutral-900 shadow-sm hover:bg-amber-500 active:scale-[0.97] transition-transform"
          >
            <Send className="h-3.5 w-3.5" /> Send
          </Button>
        )}
      </div>
    </div>
  );
}
