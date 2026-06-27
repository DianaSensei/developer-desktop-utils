import { Textarea } from '@/components/ui/textarea';
import { PaneHeader } from '@/components/ui/tool-layout';
import ReactMarkdown from 'react-markdown';
import { usePersistentState } from '@/hooks/usePersistentState';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';

const DEFAULT_MARKDOWN = `# Heading 1
## Heading 2
### Heading 3

**Bold text** and *italic text*

- List item 1
- List item 2
- List item 3

1. Numbered item 1
2. Numbered item 2

[Link](https://example.com)

\`inline code\`

\`\`\`javascript
const code = 'block';
console.log(code);
\`\`\`

> Blockquote
`;

export function MarkdownPreview() {
  const [markdown, setMarkdown] = usePersistentState('devtool:markdown:content', DEFAULT_MARKDOWN);

  useQuickPaste(setMarkdown);
  useInputHistory(markdown, setMarkdown);

  return (
    <div className="grid grid-cols-2 h-full divide-x overflow-hidden">
      {/* Editor */}
      <div className="flex flex-col min-h-0">
        <PaneHeader label="Markdown" hint={quickPasteHint} />
        <Textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          placeholder="Enter markdown here"
          spellCheck  // prose editor — keep spell-check squiggles
          className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
        />
      </div>

      {/* Preview */}
      <div className="flex flex-col min-h-0">
        <PaneHeader label="Preview" />
        <div className="flex-1 min-h-0 overflow-y-auto p-4 prose dark:prose-invert prose-sm max-w-none">
          <ReactMarkdown>{markdown}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
