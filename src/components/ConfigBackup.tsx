// Settings → Backup & restore: export the whole app or chosen tools to a
// JSON file, import one back (replace or merge), and undo the last import.
// The logic lives in lib/configTransfer.ts; this is the screen for it.

import { useMemo, useState } from 'react';
import { Download, RotateCcw, ShieldCheck, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Checkbox } from '@/components/ui/checkbox';
import { Segmented } from '@/components/ui/segmented';
import { useCurrentLocale, useMessages } from '@/contexts/LocaleContext';
import { getPlugin } from '@/platform';
import {
  buildExport, exportFileName, importConfig, parseConfigFile, readUndo, reloadWith, serializeConfig,
  summarizeApp, summarizeFile, toolsWithData, undoLastImport,
  type ConfigFile, type ImportMode, type ParseError,
} from '@/lib/configTransfer';
import { pickConfigText, saveConfigText } from '@/lib/configFile';
import MESSAGES from './configBackup.messages';

type M = ReturnType<typeof useMessages<typeof MESSAGES>>;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function toolLabel(id: string): string {
  return getPlugin(id)?.label ?? id;
}

/** Short description of what an import covered, for the notice and Undo. */
export function importLabel(m: M, toolIds: string[], includeApp: boolean, allTools: boolean): string {
  if (includeApp && allTools) return m('labelAll');
  if (!includeApp && toolIds.length === 1) return toolLabel(toolIds[0]);
  if (includeApp && toolIds.length === 0) return m('appSettings');
  return includeApp ? m('labelAppAndTools', { n: toolIds.length }) : m('labelTools', { n: toolIds.length });
}

async function appVersion(): Promise<string | undefined> {
  if (!isTauri) return undefined;
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return undefined;
  }
}

const PARSE_ERRORS: Record<ParseError, keyof typeof MESSAGES> = {
  notJson: 'errNotJson', wrongFormat: 'errWrongFormat', newerVersion: 'errNewerVersion', empty: 'errEmpty',
};

export function ConfigBackup() {
  const m = useMessages(MESSAGES);
  const locale = useCurrentLocale();
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
  };

  return (
    <section className="space-y-4">
      <p className="text-xs text-fg-mute">{m('intro')}</p>
      <ExportCard m={m} />
      <ImportCard m={m} when={when} />
      <UndoCard m={m} when={when} />
      <div className="flex items-start gap-2 rounded-md border border-line bg-bg-2/30 px-3 py-2 text-[11px] leading-relaxed text-fg-mute">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{m('notIncluded')}</span>
      </div>
    </section>
  );
}

function Card({ icon: Icon, title, hint, children }: { icon: typeof Download; title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line">
      <div className="flex items-start gap-2.5 border-b border-line px-4 py-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-fg-mute" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-mute">{hint}</p>
        </div>
      </div>
      <div className="space-y-3 px-4 py-3">{children}</div>
    </div>
  );
}

interface Row { id: string; label: string; detail: string; badge?: string }

function Checklist({ rows, selected, onToggle, onAll, m }: {
  rows: Row[]; selected: Set<string>; onToggle: (id: string) => void; onAll: (on: boolean) => void; m: M;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-end gap-3 text-[11px]">
        <button type="button" className="text-acc-ink hover:underline" onClick={() => onAll(true)}>{m('selectAll')}</button>
        <button type="button" className="text-fg-mute hover:text-fg hover:underline" onClick={() => onAll(false)}>{m('selectNone')}</button>
      </div>
      <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
        {rows.map((r) => (
          <li key={r.id}>
            <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-bg-2/40">
              <Checkbox size="sm" checked={selected.has(r.id)} onCheckedChange={() => onToggle(r.id)} aria-label={r.label} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {r.label}
                  {r.badge && <span className="ml-1.5 rounded-full bg-bg-2 px-1.5 text-[11px] font-normal text-fg-mute">{r.badge}</span>}
                </span>
                <span className="block truncate text-[11px] text-fg-mute">{r.detail}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

const APP_ROW = '__app__';

function useSelection(initial: string[]) {
  const [selected, setSelected] = useState(() => new Set(initial));
  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return { selected, setSelected, toggle };
}

function ExportCard({ m }: { m: M }) {
  const tools = useMemo(() => toolsWithData(), []);
  const app = useMemo(() => summarizeApp(), []);
  const rows: Row[] = [
    { id: APP_ROW, label: m('appSettings'), detail: `${m('appSettingsHint')} · ${m('entries', { n: app.keys, size: formatBytes(app.bytes) })}` },
    ...tools.map((t) => ({ id: t.id, label: toolLabel(t.id), detail: m('entries', { n: t.keys, size: formatBytes(t.bytes) }) })),
  ];
  const { selected, setSelected, toggle } = useSelection(rows.map((r) => r.id));
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const includeApp = selected.has(APP_ROW);
      const toolIds = tools.map((t) => t.id).filter((id) => selected.has(id));
      const file = buildExport({ toolIds, includeApp, appVersion: await appVersion() });
      const name = exportFileName(toolIds, includeApp);
      if (await saveConfigText(name, serializeConfig(file))) setStatus({ tone: 'success', text: m('exported', { name }) });
    } catch (e) {
      setStatus({ tone: 'error', text: m('exportFailed', { msg: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card icon={Download} title={m('exportTitle')} hint={m('exportHint')}>
      <Checklist rows={rows} selected={selected} onToggle={toggle} onAll={(on) => setSelected(new Set(on ? rows.map((r) => r.id) : []))} m={m} />
      {tools.length === 0 && <p className="text-[11px] text-fg-mute">{m('noToolData')}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" className="gap-1.5" disabled={selected.size === 0 || busy} onClick={() => void run()}>
          <Download className="h-3.5 w-3.5" />{m('exportButton')}
        </Button>
        {status && <span className={cn('text-[11px]', status.tone === 'error' ? 'text-bad' : 'text-ok')}>{status.text}</span>}
      </div>
    </Card>
  );
}

function ImportCard({ m, when }: { m: M; when: (iso: string) => string }) {
  const [file, setFile] = useState<{ name: string; data: ConfigFile } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>('replace');
  const { selected, setSelected, toggle } = useSelection([]);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    setError(null);
    try {
      const picked = await pickConfigText();
      if (!picked) return;
      const parsed = parseConfigFile(picked.text);
      if (!parsed.ok) {
        setFile(null);
        setError(m(PARSE_ERRORS[parsed.error]));
        return;
      }
      setFile({ name: picked.name, data: parsed.file });
      setSelected(new Set([...(parsed.file.app ? [APP_ROW] : []), ...Object.keys(parsed.file.tools)]));
    } catch (e) {
      setError(m('errRead', { msg: e instanceof Error ? e.message : String(e) }));
    }
  };

  const rows: Row[] = file
    ? [
        ...(file.data.app ? [{ id: APP_ROW, label: m('appSettings'), detail: m('entries', { n: Object.keys(file.data.app).length, size: formatBytes(summarizeApp(file.data.app).bytes) }) }] : []),
        ...summarizeFile(file.data).map((t) => ({
          id: t.id,
          label: toolLabel(t.id),
          detail: m('entries', { n: t.keys, size: formatBytes(t.bytes) }),
          badge: getPlugin(t.id) ? undefined : m('notInstalled'),
        })),
      ]
    : [];

  const run = async () => {
    if (!file) return;
    setBusy(true);
    const includeApp = selected.has(APP_ROW);
    const toolIds = Object.keys(file.data.tools).filter((id) => selected.has(id));
    const all = toolIds.length === Object.keys(file.data.tools).length && (!file.data.app || includeApp);
    const label = importLabel(m, toolIds, includeApp, all && includeApp);
    const changed = importConfig(file.data, { toolIds, includeApp, mode, label });
    await reloadWith({ kind: 'import', label, changed });
  };

  return (
    <Card icon={Upload} title={m('importTitle')} hint={m('importHint')}>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void pick()}>
          <Upload className="h-3.5 w-3.5" />{file ? m('pickOther') : m('pickFile')}
        </Button>
        {file && (
          <span className="min-w-0 truncate text-[11px] text-fg-mute">
            <span className="font-medium text-fg">{file.name}</span>
            {file.data.exportedAt && ` · ${file.data.appVersion
              ? m('fileInfoVersion', { when: when(file.data.exportedAt), version: file.data.appVersion })
              : m('fileInfo', { when: when(file.data.exportedAt) })}`}
          </span>
        )}
      </div>
      {error && <Callout tone="error" size="sm">{error}</Callout>}
      {file && (
        <>
          <Checklist rows={rows} selected={selected} onToggle={toggle} onAll={(on) => setSelected(new Set(on ? rows.map((r) => r.id) : []))} m={m} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs">{m('modeLabel')}</span>
            <Segmented
              size="sm"
              aria-label={m('modeLabel')}
              value={mode}
              onValueChange={setMode}
              options={[{ value: 'replace', label: m('modeReplace') }, { value: 'merge', label: m('modeMerge') }]}
            />
            <span className="min-w-0 basis-full text-[11px] text-fg-mute">{mode === 'replace' ? m('modeReplaceHint') : m('modeMergeHint')}</span>
          </div>
          <Button size="sm" className="gap-1.5" disabled={selected.size === 0 || busy} onClick={() => void run()}>
            <Upload className="h-3.5 w-3.5" />{m('importButton')}
          </Button>
        </>
      )}
    </Card>
  );
}

function UndoCard({ m, when }: { m: M; when: (iso: string) => string }) {
  const snapshot = useMemo(() => readUndo(), []);
  if (!snapshot) return null;
  return (
    <Card icon={RotateCcw} title={m('undoTitle')} hint={m('undoHint', { label: snapshot.label, when: when(snapshot.at) })}>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => {
          const label = snapshot.label;
          undoLastImport();
          void reloadWith({ kind: 'undo', label, changed: Object.keys(snapshot.entries).length });
        }}
      >
        <RotateCcw className="h-3.5 w-3.5" />{m('undoButton')}
      </Button>
    </Card>
  );
}
