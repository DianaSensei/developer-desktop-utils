// One-click snippet menu, appended to a script's current text — see
// scriptSnippets.ts for why appendSnippet appends rather than inserting at
// the cursor (the editors here have no imperative cursor-insert API). Shared
// by every script editor in the tool (request-level, collection/folder-level)
// so the same PRE_REQUEST_SNIPPETS/POST_RESPONSE_SNIPPETS are one click away
// wherever a script can be written.

import { Sparkles } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import type { ScriptSnippet } from './scriptSnippets';

export function SnippetMenu({ snippets, onInsert }: { snippets: ScriptSnippet[]; onInsert: (s: ScriptSnippet) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 text-[11px] font-medium text-fg-mute transition-colors hover:text-fg">
        <Sparkles className="h-3 w-3" /> Snippet
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {snippets.map((s) => (
          <DropdownMenuItem key={s.label} onClick={() => onInsert(s)}>{s.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
