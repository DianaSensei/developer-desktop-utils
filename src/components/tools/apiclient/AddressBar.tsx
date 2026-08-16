// The method + URL + Send bar. It spans the full width above the request/response
// split (Bruno layout), so both panes sit beneath one shared address bar.

import { Code2, Send, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { methodBg, methodColor } from './method-color';
import { InlineCodeField } from '@/design-system';
import { paramsFromUrl } from './request';
import { parseCurl } from './curl';
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
  const pathParamValues: Record<string, string> = {};
  for (const p of request.pathParams) if (p.enabled && p.key) pathParamValues[p.key] = p.value;

  // Typing in the URL keeps the Params table in sync. Ignore echoes where the
  // value is unchanged (e.g. when a params edit rewrote the URL).
  //
  // Pasting a whole `curl ...` command is also handled here: the editor is
  // single-line, so a multi-line command arrives with its `\<newline>`
  // continuations already flattened to spaces by InlineCodeField — restore the space
  // curl.ts itself would have produced before handing it to the parser.
  const handleUrl = (url: string) => {
    if (url === request.url) return;
    const trimmed = url.trim();
    if (/^curl(\s|$)/i.test(trimmed)) {
      try {
        const parsed = parseCurl(trimmed.replace(/\\\s+/g, ' '));
        if (parsed.url.trim()) {
          onChange({
            method: parsed.method,
            url: parsed.url,
            params: paramsFromUrl(parsed.url, []),
            headers: parsed.headers,
            body: parsed.body,
            auth: parsed.auth,
          });
          return;
        }
      } catch {
        // Not a parseable cURL command after all — fall through and treat the
        // paste as a literal URL edit.
      }
    }
    onChange({ url, params: paramsFromUrl(url, request.params) });
  };

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center overflow-hidden rounded-lg border border-line bg-bg shadow-sm transition-shadow focus-within:shadow-none focus-within:ring-2 focus-within:ring-acc/40">
        {/* Method selector — tinted to match the active HTTP method (Bruno-style) */}
        <Select value={request.method} onValueChange={(v) => onChange({ method: v as ApiRequest['method'] })}>
          <SelectTrigger
            className={cn(
              'h-ctl-lg w-[6.5rem] shrink-0 border-0 font-bold shadow-none focus:ring-0 rounded-r-none',
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
        <span className="h-5 w-px shrink-0 bg-line" />

        <div className="flex h-ctl-lg min-w-0 flex-1 items-center px-3">
          <InlineCodeField
            value={request.url}
            onChange={handleUrl}
            vars={vars}
            pathParamValues={pathParamValues}
            onEnter={onSend}
            placeholder="https://api.example.com/users/{{id}}"
          />
        </div>

        {/* Code generator */}
        <IconButton onClick={onGenerateCode} title="Generate Code">
          <Code2 className="h-4 w-4" />
        </IconButton>

        {/* Send / Cancel */}
        {sending ? (
          <Button variant="destructive" size="sm" onClick={onCancel} className="m-1 h-ctl gap-1.5 rounded-sm">
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onSend}
            disabled={!request.url.trim()}
            className="m-1 h-ctl gap-1.5 rounded-sm shadow-sm active:scale-[0.97] transition-transform"
          >
            <Send className="h-3.5 w-3.5" /> Send
          </Button>
        )}
      </div>
    </div>
  );
}
