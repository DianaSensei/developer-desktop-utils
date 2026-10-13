import { Input } from '@/components/ui/input';
import { ToolLabel, ToolHint } from '@/components/ui/tool-section';
import { JsonEditor, TextEditor } from '@/design-system';
import type { MockConfig } from './types';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from '@/components/tools/mockserver/MockServer.messages';

interface Props {
  config: MockConfig;
  onChange: (patch: Partial<MockConfig>) => void;
}

// Editor for the response returned when no stub matches a request.
export function FallbackEditor({ config, onChange }: Props) {
  const m = useMessages(MESSAGES);
  const isJson = /json/i.test(config.notFoundContentType);

  return (
    <div className="tool-scrollable space-y-5 p-4">
      <div className="space-y-1">
        <ToolLabel>{m('noMatchResponse')}</ToolLabel>
        <ToolHint>{m('fallbackHint')}</ToolHint>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-fg-mute">{m('status')}</span>
          <Input
            type="number"
            value={config.notFoundStatus}
            onChange={(e) => onChange({ notFoundStatus: Number(e.target.value) || 0 })}
            className="h-ctl w-20 text-xs"
          />
        </div>
        <div className="flex flex-1 items-center gap-1.5">
          <span className="shrink-0 text-xs text-fg-mute">Content-Type</span>
          <Input
            value={config.notFoundContentType}
            onChange={(e) => onChange({ notFoundContentType: e.target.value })}
            placeholder="application/json"
            className="h-ctl flex-1 font-mono text-xs"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="text-xs text-fg-mute">{m('body')}</span>
        {isJson ? (
          <JsonEditor value={config.notFoundBody} onChange={(notFoundBody) => onChange({ notFoundBody })} placeholder={m('fallbackBody')} />
        ) : (
          <TextEditor value={config.notFoundBody} onChange={(notFoundBody) => onChange({ notFoundBody })} placeholder={m('fallbackBody')} />
        )}
        <ToolHint>
          Supports the same templates as stub bodies, e.g. <code>{'{{request.path}}'}</code>.
        </ToolHint>
      </div>
    </div>
  );
}
