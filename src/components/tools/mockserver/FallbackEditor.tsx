import { Input } from '@/components/ui/input';
import { ToolLabel, ToolHint } from '@/components/ui/tool-section';
import { CodeEditor } from '../apiclient/CodeEditor';
import type { MockConfig } from './types';

interface Props {
  config: MockConfig;
  onChange: (patch: Partial<MockConfig>) => void;
}

// Editor for the response returned when no stub matches a request.
export function FallbackEditor({ config, onChange }: Props) {
  const isJson = /json/i.test(config.notFoundContentType);

  return (
    <div className="tool-scrollable space-y-5 p-4">
      <div className="space-y-1">
        <ToolLabel>No-match response</ToolLabel>
        <ToolHint>Returned for any request that doesn’t match an enabled stub.</ToolHint>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Status</span>
          <Input
            type="number"
            value={config.notFoundStatus}
            onChange={(e) => onChange({ notFoundStatus: Number(e.target.value) || 0 })}
            className="h-8 w-20 text-xs"
          />
        </div>
        <div className="flex flex-1 items-center gap-1.5">
          <span className="shrink-0 text-xs text-muted-foreground">Content-Type</span>
          <Input
            value={config.notFoundContentType}
            onChange={(e) => onChange({ notFoundContentType: e.target.value })}
            placeholder="application/json"
            className="h-8 flex-1 font-mono text-xs"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="text-xs text-muted-foreground">Body</span>
        <div className="overflow-hidden rounded-md border">
          <CodeEditor
            key={isJson ? 'json' : 'text'}
            language={isJson ? 'json' : 'text'}
            value={config.notFoundBody}
            onChange={(notFoundBody) => onChange({ notFoundBody })}
            placeholder="Fallback response body"
          />
        </div>
        <ToolHint>
          Supports the same templates as stub bodies, e.g. <code>{'{{request.path}}'}</code>.
        </ToolHint>
      </div>
    </div>
  );
}
