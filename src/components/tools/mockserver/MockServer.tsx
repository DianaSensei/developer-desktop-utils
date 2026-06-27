import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Square, Plus, Copy as CopyIcon, Trash2, AlertTriangle, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CopyButton } from '@/components/ui/copy-button';
import { ToolToolbar } from '@/components/ui/tool-layout';
import { usePersistentState } from '@/hooks/usePersistentState';
import { cn } from '@/lib/utils';
import { SplitPane } from '../apiclient/SplitPane';
import { methodBadgeStyle } from '../apiclient/method-color';
import type { HttpMethod } from '../apiclient/types';
import { StubEditor } from './StubEditor';
import { RequestLog } from './RequestLog';
import { useMockServer, isTauri } from './useMockServer';
import { newStub, type Stub } from './types';

export function MockServer() {
  const { config, setConfig, updateStub, status, log, error, busy, start, stop, testScript, clearLog } =
    useMockServer();

  const [selectedId, setSelectedId] = useState<string | null>(config.stubs[0]?.id ?? null);
  const [logVisible, setLogVisible] = usePersistentState('devtool:mockServer:logVisible', true);

  // Stub list is a fixed-width sidebar (px, persisted) so it stays narrow and
  // stable regardless of whether the request log is shown — the editor and log
  // share all the remaining space.
  const [sidebarW, setSidebarW] = usePersistentState('devtool:mockServer:sidebarW', 220);
  const [dragging, setDragging] = useState(false);
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);

  const startSidebarDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarW;
      setDragging(true);
      const move = (ev: PointerEvent) => setSidebarW(Math.min(420, Math.max(160, startW + ev.clientX - startX)));
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

  // Keep the selection valid as stubs are added / removed.
  useEffect(() => {
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
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={addStub} aria-label="Add stub">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {config.stubs.map((s) => (
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
            <span
              className={cn(
                'w-12 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-semibold',
                methodBadgeStyle(s.method as HttpMethod),
              )}
            >
              {s.method}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{s.name || '(unnamed)'}</div>
              <div className="truncate font-mono text-[10px] text-muted-foreground">{s.path}</div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  duplicateStub(s);
                }}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Duplicate stub"
                title="Duplicate"
              >
                <CopyIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteStub(s.id);
                }}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                aria-label="Delete stub"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
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
    </div>
  );

  const editorPane = selected ? (
    <StubEditor
      key={selected.id}
      stub={selected}
      onChange={(patch) => updateStub(selected.id, patch)}
      testScript={testScript}
    />
  ) : (
    <div className="flex h-full w-full flex-1 items-center justify-center text-sm text-muted-foreground">
      Select or add a stub.
    </div>
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
        {/* Fixed-width, drag-resizable stub list */}
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

        {/* Editor (hero) + optional resizable log */}
        <div className="flex min-h-0 min-w-0 flex-1">
          {logVisible ? (
            <SplitPane
              direction="horizontal"
              initialPercent={68}
              minPercent={35}
              minPanePx={300}
              first={editorPane}
              second={<RequestLog log={log} onClear={clearLog} />}
            />
          ) : (
            editorPane
          )}
        </div>
      </div>
    </div>
  );
}
