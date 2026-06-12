import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
    <Card>
      <CardHeader>
        <CardTitle>Markdown Preview</CardTitle>
        <CardDescription>Write and preview Markdown in real-time</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Markdown Input</Label>
            <Textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder={`Enter markdown here — ${quickPasteHint}`}
              className="min-h-[500px] font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label>Preview</Label>
            <div className="border rounded-md p-4 min-h-[500px] overflow-auto prose dark:prose-invert prose-sm max-w-none">
              <ReactMarkdown>{markdown}</ReactMarkdown>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
