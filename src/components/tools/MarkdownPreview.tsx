import { useEffect, useRef } from 'react';
import { usePluginSdkFor, usePluginState } from '@/platform';
import { EditorView, basicSetup } from 'codemirror';
import { keymap, placeholder as placeholderExt } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { useCodeTheme } from '@/components/ui/code-theme';
import { PaneHeader } from '@/components/ui/tool-layout';
import { MarkdownView } from '@/components/ui/markdown-view';
import { useQuickPaste, useQuickPasteHint } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from '@/components/tools/MarkdownPreview.messages';

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

const markdownLang = markdown();

// Bespoke CodeMirror setup rather than the shared `TextEditor` — this is a
// prose surface (needs the browser's native spell-check) where every other
// code-editor.tsx wrapper deliberately turns spellcheck off. Same rationale
// as SqlFormatter's own setup: the shared engine's defaults are wrong here,
// not just insufficiently configured.
function MarkdownSourceEditor({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastValueRef = useRef(value);
  const theme = useCodeTheme(viewRef, { gutter: 'flush' });

  useEffect(() => {
    if (!containerRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          keymap.of([indentWithTab]),
          basicSetup,
          markdownLang,
          // CodeMirror defaults every editor to spellcheck off (code isn't
          // prose) — this is prose, so put it back on.
          EditorView.contentAttributes.of({ spellcheck: 'true' }),
          theme.extension,
          EditorView.lineWrapping,
          ...(placeholder ? [placeholderExt(placeholder)] : []),
          EditorView.updateListener.of((upd) => {
            if (!upd.docChanged) return;
            const val = upd.state.doc.toString();
            lastValueRef.current = val;
            onChangeRef.current(val);
          }),
        ],
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastValueRef.current) return;
    lastValueRef.current = value;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={containerRef} className="flex flex-1 min-h-0 flex-col overflow-hidden" />;
}

export function MarkdownPreview() {
  const sdk = usePluginSdkFor('markdown');
  const m = useMessages(MESSAGES);
  const quickPasteHint = useQuickPasteHint();
  const [markdownText, setMarkdownText] = usePluginState(sdk, 'markdown:content', DEFAULT_MARKDOWN, { legacyKey: 'devtool:markdown:content' });

  useQuickPaste(setMarkdownText);
  useInputHistory(markdownText, setMarkdownText);

  return (
    <div className="grid h-full grid-rows-2 divide-y divide-line overflow-hidden md:grid-cols-2 md:grid-rows-1 md:divide-x md:divide-y-0">
      {/* Editor */}
      <div className="flex flex-col min-h-0">
        <PaneHeader label={m('markdown')} hint={quickPasteHint} />
        <MarkdownSourceEditor value={markdownText} onChange={setMarkdownText} placeholder={m('placeholder')} />
      </div>

      {/* Preview */}
      <div className="flex flex-col min-h-0">
        <PaneHeader label={m('preview')} />
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <MarkdownView remoteImageLabel={m('remoteImage')} onOpenLink={(url) => void sdk.openExternal(url)}>{markdownText}</MarkdownView>
        </div>
      </div>
    </div>
  );
}
