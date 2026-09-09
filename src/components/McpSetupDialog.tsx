// "MCP for Claude Code" — shows a ready-to-paste `claude mcp add` command
// wired to this exact install's bundled devtool-mcp-server sidecar, so
// setting up MCP access to this tool is copy-paste from inside the app
// itself rather than hunting for the install path in a terminal.
//
// Deliberately copy-only, never auto-run: this app has no business invoking
// another CLI on the user's behalf (and the shell plugin isn't even part of
// its Tauri capabilities — see src-tauri/capabilities/default.json).

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Callout } from '@/components/ui/callout';
import { CopyButton } from '@/components/ui/copy-button';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { isTauri } from '@/lib/platform';
import { useMcpBackgroundBridge } from '@/hooks/useMcpBackgroundBridge';
import { useMcpToolEnabledMap, MCP_TOOL_IDS, MCP_TOOL_CAPABILITIES } from '@/hooks/useMcpToolEnabled';
import { TOOL_DEFS } from '@/lib/toolDefs';

type Resolution = { status: 'loading' } | { status: 'ready'; path: string } | { status: 'error'; message: string };

export function McpSetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [resolution, setResolution] = useState<Resolution>({ status: 'loading' });
  // Same persisted setting as Settings → MCP → Background MCP bridge — one
  // shared value (usePersistentState), so flipping it here or there is the
  // same action either way, in sync immediately without navigating away, and
  // regardless of whether API Client or Mock Server has ever been opened
  // before (it's an app-level setting, not scoped to either tool's own
  // local state).
  const { enabled: backgroundEnabled, setEnabled: setBackgroundEnabled } = useMcpBackgroundBridge();
  // Per-tool kill switch — independent of the background toggle above, and
  // (same reasoning) one shared value with Settings → MCP's own list.
  const { isEnabled: isToolEnabled, setToolEnabled } = useMcpToolEnabledMap();

  useEffect(() => {
    if (!open) return;
    if (!isTauri) {
      setResolution({ status: 'error', message: 'This is only available in the desktop app.' });
      return;
    }
    setResolution({ status: 'loading' });
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const path = await invoke<string>('mcp_sidecar_path');
        if (!cancelled) setResolution({ status: 'ready', path });
      } catch (e) {
        if (!cancelled) setResolution({ status: 'error', message: (e as Error).message ?? String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const command = resolution.status === 'ready'
    ? `claude mcp add devtool-api-client -- "${resolution.path}"`
    : '';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>MCP for Claude Code</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6 pb-6 text-sm">
          <p className="text-fg-mute">
            Lets an MCP client (Claude Code, Claude Desktop) list, edit, and actually{' '}
            <span className="text-fg">send</span> requests in this API Client — collections, scripts,
            environments — drive Mock Server's stubs, and manage Redis Client / Kafka Explorer
            connection profiles, all through this one registration.
          </p>

          <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
            <div>
              <p className="text-xs font-medium">Background MCP bridge</p>
              <p className="text-[11px] text-fg-mute mt-0.5">
                {backgroundEnabled
                  ? 'On — answers regardless of which tool is on screen, or whether the window is focused.'
                  : 'Off — each tool only answers MCP calls while it is the one on screen.'}
              </p>
            </div>
            <Switch
              checked={backgroundEnabled}
              onCheckedChange={setBackgroundEnabled}
              aria-label="Background MCP bridge"
            />
          </div>

          <div className="rounded-md border border-line divide-y divide-line">
            <div className="px-3 py-2">
              <p className="text-xs font-medium">Per-tool MCP access</p>
              <p className="text-[11px] text-fg-mute mt-0.5">
                Off means that tool never answers an MCP call — on screen or in the background.
              </p>
            </div>
            {MCP_TOOL_IDS.map((id) => {
              const label = TOOL_DEFS.find((td) => td.id === id)?.label ?? id;
              const enabled = isToolEnabled(id);
              return (
                <div key={id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0 pr-2">
                    <p className="text-xs">{label}</p>
                    <p className="text-[11px] text-fg-mute mt-0.5">{MCP_TOOL_CAPABILITIES[id]}</p>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(v) => setToolEnabled(id, v)}
                    aria-label={`${label} MCP access`}
                  />
                </div>
              );
            })}
          </div>

          {resolution.status === 'loading' && (
            <div className="flex items-center gap-2 text-fg-mute">
              <Spinner size="sm" /> Locating the bundled MCP sidecar…
            </div>
          )}

          {resolution.status === 'error' && (
            <Callout tone="warning">
              {resolution.message}
              {resolution.message.includes('dev build') && (
                <> See <code className="font-mono">docs/human/mcp-server.md</code> for the source-build setup instead.</>
              )}
            </Callout>
          )}

          {resolution.status === 'ready' && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-fg-mute">Run once in a terminal:</div>
              <div className="flex items-start gap-2 rounded-md border border-line bg-bg-2 px-3 py-2.5">
                <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11.5px] text-fg">{command}</pre>
                <CopyButton value={command} iconClassName="h-3.5 w-3.5" />
              </div>
              <p className="text-[11px] text-fg-mute">
                Then open a new Claude Code session and ask it about your collections, stubs, or
                connections — with the background bridge above off, each tool's MCP tools only
                answer while that tool is the one on screen.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
