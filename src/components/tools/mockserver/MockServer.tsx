import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play, Square, Plus, Copy as CopyIcon, Trash2, AlertTriangle, PanelRightClose, PanelRightOpen,
  ChevronUp, ChevronDown, Upload, FileJson, Ban,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CopyButton } from '@/components/ui/copy-button';
import { ToolToolbar } from '@/components/ui/tool-layout';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePersistentState } from '@/hooks/usePersistentState';
import { cn } from '@/lib/utils';
import { SplitPane } from '../apiclient/SplitPane';
import { methodBadgeStyle } from '../apiclient/method-color';
import type { HttpMethod } from '../apiclient/types';
import { StubEditor } from './StubEditor';
import { FallbackEditor } from './FallbackEditor';
import { RequestLog } from './RequestLog';
import { useMockServer, isTauri } from './useMockServer';
import { newStub, type MockConfig, type Stub } from './types';

// Sentinel selection id for the editable "no-match" fallback response.
const FALLBACK_ID = '__fallback__';

// "ANY" matches every method, so give it a distinct (dashed, neutral) badge
// instead of looking like a specific verb.
const badgeClass = (method: string) =>
  method === 'ANY'
    ? 'border border-dashed border-muted-foreground/50 text-muted-foreground'
    : methodBadgeStyle(method as HttpMethod);

export function MockServer() {
  const { config, setConfig, updateConfig, updateStub, status, log, error, busy, start, stop, testScript, clearLog } =
    useMockServer();

  const [selectedId, setSelectedId] = useState<string | null>(config.stubs[0]?.id ?? null);
  const [logVisible, setLogVisible] = usePersistentState('devtool:mockServer:logVisible', true);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  // Stub list is a fixed-width sidebar (px, persisted) so it stays narrow and
  // stable regardless of whether the request log is shown — the editor and log
  // share all the remaining space.
  const [sidebarW, setSidebarW] = usePersistentState('devtool:mockServer:sidebarW', 230);
  const [dragging, setDragging] = useState(false);
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);

  const startSidebarDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarW;
      setDragging(true);
      const move = (ev: PointerEvent) => setSidebarW(Math.min(420, Math.max(170, startW + ev.clientX - startX)));
      const up = () => {
        setDragging(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        dragCleanup.current = null;
      };
      dragCleanup.current = up;
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [sidebarW, setSidebarW],
  );

  // Keep the selection valid as stubs are added / removed (the fallback sentinel
  // is always valid).
  useEffect(() => {
    if (selectedId === FALLBACK_ID) return;
    if (!config.stubs.some((s) => s.id === selectedId)) {
      setSelectedId(config.stubs[0]?.id ?? null);
    }
  }, [config.stubs, selectedId]);

  const selected = config.stubs.find((s) => s.id === selectedId) ?? null;

  const addStub = () => {
    const s = newStub();
    setConfig((prev) => ({ ...prev, stubs: [...prev.stubs, s] }));
    setSelectedId(s.id);
  };
  const duplicateStub = (stub: Stub) => {
    const copy = { ...structuredClone(stub), id: crypto.randomUUID(), name: `${stub.name} copy` };
    setConfig((prev) => {
      const i = prev.stubs.findIndex((s) => s.id === stub.id);
      const stubs = [...prev.stubs];
      stubs.splice(i + 1, 0, copy);
      return { ...prev, stubs };
    });
    setSelectedId(copy.id);
  };
  const deleteStub = (id: string) => setConfig((prev) => ({ ...prev, stubs: prev.stubs.filter((s) => s.id !== id) }));

  // Order matters (first match wins), so let users reorder stubs.
  const moveStub = (id: string, dir: -1 | 1) =>
    setConfig((prev) => {
      const i = prev.stubs.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.stubs.length) return prev;
      const stubs = [...prev.stubs];
      [stubs[i], stubs[j]] = [stubs[j], stubs[i]];
      return { ...prev, stubs };
    });

  const exportJson = () => JSON.stringify(config, null, 2);
  const doImport = () => {
    try {
      const parsed = JSON.parse(importText) as Partial<MockConfig>;
      if (!parsed || !Array.isArray(parsed.stubs)) throw new Error('JSON must contain a "stubs" array.');
      // Normalize each stub against defaults so older/partial exports still load.
      const stubs: Stub[] = parsed.stubs.map((s) => ({ ...newStub(), ...(s as Stub), id: (s as Stub).id || crypto.randomUUID() }));
      setConfig((prev) => ({ ...prev, ...parsed, stubs }));
      setSelectedId(stubs[0]?.id ?? null);
      setImportOpen(false);
      setImportText('');
      setImportError(null);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  };

  const displayHost = status.running ? status.host : config.host;
  const displayPort = status.running ? status.port : config.port;
  // Local + LAN binds are reachable as localhost (the local option binds both
  // IPv4 and IPv6), so present the friendly hostname clients will actually use.
  const shownHost = displayHost === '0.0.0.0' || displayHost === '127.0.0.1' ? 'localhost' : displayHost;
  const baseUrl = `http://${shownHost}:${displayPort}`;

  // ── Panels ───────────────────────────────────────────────────────────────
  const stubListPane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">Stubs</span>
        <div className="flex items-center gap-0.5">
          <CopyButton
            value={exportJson}
            icon={FileJson}
            iconClassName="h-3.5 w-3.5"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            label=""
            title="Copy all stubs as JSON"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => { setImportText(''); setImportError(null); setImportOpen(true); }}
            aria-label="Import stubs"
            title="Import stubs from JSON"
          >
            <Upload className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={addStub} aria-label="Add stub" title="Add stub">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {config.stubs.map((s, i) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelectedId(s.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelectedId(s.id)}
            className={cn(
              'group flex cursor-pointer items-center gap-2 border-l-2 px-3 py-2 transition-colors hover:bg-muted/40',
              s.id === selectedId ? 'border-l-primary bg-muted/60' : 'border-l-transparent',
              !s.enabled && 'opacity-50',
            )}
          >
            <span className={cn('w-11 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-semibold', badgeClass(s.method))}>
              {s.method}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{s.name || '(unnamed)'}</div>
              <div className="truncate font-mono text-[10px] text-muted-foreground">{s.path}</div>
            </div>
            <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
              <IconBtn label="Move up" title="Move up" disabled={i === 0} onClick={(e) => { e.stopPropagation(); moveStub(s.id, -1); }}>
                <ChevronUp className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn label="Move down" title="Move down" disabled={i === config.stubs.length - 1} onClick={(e) => { e.stopPropagation(); moveStub(s.id, 1); }}>
                <ChevronDown className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn label="Duplicate stub" title="Duplicate" onClick={(e) => { e.stopPropagation(); duplicateStub(s); }}>
                <CopyIcon className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn label="Delete stub" title="Delete" danger onClick={(e) => { e.stopPropagation(); deleteStub(s.id); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </IconBtn>
            </div>
          </div>
        ))}
        {config.stubs.length === 0 && (
          <button
            type="button"
            onClick={addStub}
            className="m-3 flex w-[calc(100%-1.5rem)] items-center justify-center gap-1.5 rounded-md border border-dashed py-6 text-xs text-muted-foreground hover:bg-muted/40"
          >
            <Plus className="h-4 w-4" /> Add your first stub
          </button>
        )}
      </div>

      {/* Pinned editable fallback (no-match) response */}
      <button
        type="button"
        onClick={() => setSelectedId(FALLBACK_ID)}
        className={cn(
          'flex shrink-0 items-center gap-2 border-l-2 border-t border-border px-3 py-2 text-left transition-colors hover:bg-muted/40',
          selectedId === FALLBACK_ID ? 'border-l-primary bg-muted/60' : 'border-l-transparent',
        )}
      >
        <span className="flex w-11 shrink-0 items-center justify-center rounded bg-muted/60 py-0.5 text-muted-foreground">
          <Ban className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">No-match response</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">default · {config.notFoundStatus}</div>
        </div>
      </button>
    </div>
  );

  const editorPane =
    selectedId === FALLBACK_ID ? (
      <FallbackEditor config={config} onChange={updateConfig} />
    ) : selected ? (
      <StubEditor key={selected.id} stub={selected} onChange={(patch) => updateStub(selected.id, patch)} testScript={testScript} />
    ) : (
      <div className="flex h-full w-full flex-1 items-center justify-center text-sm text-muted-foreground">Select or add a stub.</div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Server controls ─────────────────────────────────────────────── */}
      <ToolToolbar className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'h-2.5 w-2.5 rounded-full',
              status.running ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.2)]' : 'bg-muted-foreground/40',
            )}
          />
          <span className="text-xs font-medium">{status.running ? 'Running' : 'Stopped'}</span>
        </div>

        <Select value={config.host} onValueChange={(v) => setConfig((p) => ({ ...p, host: v }))} disabled={status.running}>
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="127.0.0.1" className="text-xs">Local (localhost · IPv4+IPv6)</SelectItem>
            <SelectItem value="0.0.0.0" className="text-xs">0.0.0.0 (LAN)</SelectItem>
          </SelectContent>
        </Select>

        <Input
          type="number"
          value={config.port}
          onChange={(e) => setConfig((p) => ({ ...p, port: Math.max(0, Number(e.target.value) || 0) }))}
          disabled={status.running}
          className="h-8 w-24 text-xs"
          aria-label="Port"
        />

        {status.running ? (
          <Button type="button" variant="destructive" size="sm" className="h-8 text-xs" onClick={stop} disabled={busy}>
            <Square className="mr-1 h-3.5 w-3.5" />
            Stop
          </Button>
        ) : (
          <Button type="button" size="sm" className="h-8 text-xs" onClick={start} disabled={busy || !isTauri}>
            <Play className="mr-1 h-3.5 w-3.5" />
            Start
          </Button>
        )}

        <div className="flex items-center gap-1 rounded-md border bg-muted/30 px-2 py-1 font-mono text-xs">
          <span className="text-muted-foreground">{baseUrl}</span>
          <CopyButton value={baseUrl} icon={CopyIcon} iconClassName="h-3 w-3" />
        </div>

        {config.host === '0.0.0.0' && (
          <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            Exposed to your local network
          </span>
        )}

        {error && <span className="text-[11px] text-destructive">{error}</span>}
        {!isTauri && <span className="text-[11px] text-muted-foreground">Server runs in the desktop app only.</span>}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-8 text-xs text-muted-foreground"
          onClick={() => setLogVisible((v) => !v)}
        >
          {logVisible ? <PanelRightClose className="mr-1 h-3.5 w-3.5" /> : <PanelRightOpen className="mr-1 h-3.5 w-3.5" />}
          {logVisible ? 'Hide log' : 'Show log'}
        </Button>
      </ToolToolbar>

      {/* ── Body: [stubs] · editor [· log] ──────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 shrink-0 flex-col overflow-hidden" style={{ width: sidebarW }}>
          {stubListPane}
        </div>
        <div
          onPointerDown={startSidebarDrag}
          className={cn(
            'group relative w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40',
            dragging && 'bg-primary/60',
          )}
        >
          <span className="absolute -inset-x-1 inset-y-0" />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1">
          {logVisible ? (
            <SplitPane
              direction="horizontal"
              initialPercent={68}
              minPercent={35}
              minPanePx={300}
              first={editorPane}
              second={
                <RequestLog
                  log={log}
                  onClear={clearLog}
                  stubName={(id) => config.stubs.find((s) => s.id === id)?.name}
                  onSelectStub={(id) => setSelectedId(id)}
                />
              }
            />
          ) : (
            editorPane
          )}
        </div>
      </div>

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import stubs</DialogTitle>
            <DialogDescription>
              Paste a Mock Server config exported with the JSON button. This replaces your current stubs and settings.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder='{ "stubs": [ … ], "host": "127.0.0.1", "port": 8787, … }'
            spellCheck={false}
            className="h-56 w-full resize-none rounded-md border bg-card p-2 font-mono text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          {importError && <p className="text-xs text-destructive">{importError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={doImport} disabled={!importText.trim()}>
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Small hover-action icon button used in the stub list rows.
function IconBtn({
  children, onClick, label, title, disabled, danger,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  label: string;
  title: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      className={cn(
        'rounded p-1 text-muted-foreground transition-colors',
        disabled ? 'cursor-default opacity-30' : danger ? 'hover:bg-muted hover:text-destructive' : 'hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
