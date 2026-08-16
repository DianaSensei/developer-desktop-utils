// Data Format Converter — converts structured data between JSON, YAML, TOML,
// CSV, and XML. Everything goes source → plain JS value → target, so one parser
// and one serializer per format gives the full N×N matrix. All parsing is
// pure-JS and runs in the browser (libraries are lazy-loaded per format), so the
// tool works fully offline.

import { useEffect, useState } from 'react';
import { ArrowLeftRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { ExplainBand } from '@/components/ui/explain-band';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CodeViewer, JsonEditor, TextEditor } from '@/design-system';
import { saveTextFile } from '@/components/tools/apiclient/fileio';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useQuickPaste } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import { parseProperties, stringifyProperties } from '@/lib/properties';

type Format = 'json' | 'yaml' | 'toml' | 'xml' | 'properties';

const FORMATS: { value: Format; label: string; ext: string }[] = [
  { value: 'json',       label: 'JSON',       ext: 'json' },
  { value: 'yaml',       label: 'YAML',       ext: 'yaml' },
  { value: 'toml',       label: 'TOML',       ext: 'toml' },
  { value: 'xml',        label: 'XML',        ext: 'xml'  },
  { value: 'properties', label: 'Properties', ext: 'properties' },
];

const PLACEHOLDERS: Record<Format, string> = {
  json: '[\n  { "id": 1, "name": "Ada" }\n]',
  yaml: '- id: 1\n  name: Ada',
  toml: 'title = "demo"\n\n[owner]\nname = "Ada"',
  xml:  '<users>\n  <user id="1">Ada</user>\n</users>',
  properties: 'database.host=localhost\ndatabase.port=5432',
};

interface Options {
  indent: number;     // JSON / YAML / XML indent
  xmlPretty: boolean; // pretty-print XML output
}

// ─── Parsers: format → plain JS value ────────────────────────────────────────

async function parseInput(fmt: Format, text: string): Promise<unknown> {
  switch (fmt) {
    case 'json':
      return JSON.parse(text);
    case 'yaml': {
      const { load } = await import('js-yaml');
      return load(text);
    }
    case 'toml': {
      const { parse } = await import('smol-toml');
      return parse(text);
    }
    case 'xml': {
      const { XMLParser } = await import('fast-xml-parser');
      return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: true }).parse(text);
    }
    case 'properties':
      return parseProperties(text);
  }
}

// ─── Serializers: plain JS value → format ────────────────────────────────────

async function serializeOutput(fmt: Format, value: unknown, opts: Options): Promise<string> {
  switch (fmt) {
    case 'json':
      return JSON.stringify(value, null, opts.indent);
    case 'yaml': {
      const { dump } = await import('js-yaml');
      return dump(value, { indent: opts.indent });
    }
    case 'toml': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('TOML output needs a top-level table — your data is an array or scalar at the root. Wrap it in an object first.');
      }
      const { stringify } = await import('smol-toml');
      return stringify(value as Record<string, unknown>);
    }
    case 'xml': {
      const { XMLBuilder } = await import('fast-xml-parser');
      // XML needs a single root element; wrap arrays/scalars so the output is valid.
      let toBuild: unknown = value;
      if (Array.isArray(value)) toBuild = { root: { item: value } };
      else if (value === null || typeof value !== 'object') toBuild = { root: value };
      return new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        format: opts.xmlPretty,
        indentBy: ' '.repeat(opts.indent),
      }).build(toBuild);
    }
    case 'properties':
      return stringifyProperties(value);
  }
}

function errMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error:\s*/, '');
}

export function DataConverter() {
  const [from, setFrom] = usePersistentState<Format>('devtool:dataConverter:from', 'json');
  const [to, setTo] = usePersistentState<Format>('devtool:dataConverter:to', 'yaml');
  const [input, setInput] = usePersistentState('devtool:dataConverter:input', '');
  const [indent, setIndent] = usePersistentState<'2' | '4'>('devtool:dataConverter:indent', '2');
  const [xmlPretty, setXmlPretty] = usePersistentState('devtool:dataConverter:xmlPretty', true);

  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);

  useQuickPaste(setInput);
  useInputHistory(input, setInput);

  // Reset a stale persisted format (e.g. a removed one) to a valid default.
  useEffect(() => {
    if (!FORMATS.some((f) => f.value === from)) setFrom('json');
    if (!FORMATS.some((f) => f.value === to)) setTo('yaml');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-convert (debounced) whenever the input, formats, or options change.
  useEffect(() => {
    const text = input.trim();
    if (!text) { setOutput(''); setError(null); return; }

    let cancelled = false;
    const handle = setTimeout(() => {
      (async () => {
        try {
          const value = await parseInput(from, input);
          const out = await serializeOutput(to, value, {
            indent: Number(indent),
            xmlPretty,
          });
          if (!cancelled) { setOutput(out); setError(null); }
        } catch (e) {
          if (!cancelled) { setError(errMessage(e)); setOutput(''); }
        }
      })();
    }, 180);

    return () => { cancelled = true; clearTimeout(handle); };
  }, [input, from, to, indent, xmlPretty]);

  // Swap directions: the current result becomes the new input.
  const handleSwap = () => {
    setFrom(to);
    setTo(from);
    if (output) setInput(output);
  };

  const handleDownload = () => {
    if (!output) return;
    const ext = FORMATS.find((f) => f.value === to)?.ext ?? 'txt';
    void saveTextFile(`converted.${ext}`, output);
  };

  const showXmlOpts = to === 'xml';
  const SourceEditor = from === 'json' ? JsonEditor : TextEditor;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 header-chrome px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* From → To */}
          <div className="flex items-center gap-2">
            <Select value={from} onValueChange={(v) => setFrom(v as Format)}>
              <SelectTrigger className="h-ctl w-[104px] text-xs rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSwap}
              title="Swap directions"
              className="h-ctl w-ctl shrink-0 rounded-sm text-fg-mute hover:text-fg"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
            <Select value={to} onValueChange={(v) => setTo(v as Format)}>
              <SelectTrigger className="h-ctl w-[104px] text-xs rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="h-4 w-px bg-line shrink-0" />

          {/* Indent */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-fg-mute">Indent</span>
            <Select value={indent} onValueChange={(v) => setIndent(v as '2' | '4')}>
              <SelectTrigger className="h-ctl w-[88px] text-xs rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2 spaces</SelectItem>
                <SelectItem value="4">4 spaces</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {showXmlOpts && (
            <button
              type="button"
              onClick={() => setXmlPretty(!xmlPretty)}
              className={
                'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors select-none ' +
                (xmlPretty
                  ? 'border-acc/50 bg-acc/10 text-acc'
                  : 'border-sunk bg-transparent text-fg-mute hover:bg-bg-2 hover:text-fg')
              }
            >
              Pretty XML
            </button>
          )}
        </div>
      </div>

      {/* Editors — source | result */}
      <div className="flex flex-1 min-h-0 divide-x divide-line">
        {/* Source */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex shrink-0 items-center justify-between px-3 py-1.5 text-[11px] text-fg-mute">
            <span>Source · {FORMATS.find((f) => f.value === from)?.label}</span>
          </div>
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden px-3 pb-3">
            <SourceEditor
              value={input}
              onChange={setInput}
              placeholder={PLACEHOLDERS[from]}
            />
          </div>
        </div>

        {/* Result */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex shrink-0 items-center justify-between px-3 py-1.5 text-[11px] text-fg-mute">
            <span>Result · {FORMATS.find((f) => f.value === to)?.label}</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDownload}
                disabled={!output}
                title="Download result"
                className="h-6 w-6 rounded text-fg-mute hover:text-fg"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
              <CopyButton value={() => output} iconClassName="h-3.5 w-3.5" disabled={!output} />
            </div>
          </div>
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden px-3 pb-3">
            {error ? (
              <div className="flex-1 overflow-auto">
                <ExplainBand tone="bad" title="Conversion error" className="font-mono">
                  {error}
                </ExplainBand>
              </div>
            ) : (
              <CodeViewer
                value={output}
                language={to === 'json' ? 'json' : 'text'}
                placeholder="Converted output appears here…"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
