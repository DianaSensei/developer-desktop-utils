// "⋯" in the tool header: export / import / reset the current tool's saved
// data, and a way to the whole-app Backup & restore in Settings. Export and
// import use the same file format as Settings (lib/configTransfer.ts), so a
// whole-app backup can be loaded into one tool and vice versa.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArchiveRestore, Download, MoreHorizontal, RotateCcw, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useMessages } from '@/contexts/LocaleContext';
import { isTauri } from '@/lib/platform';
import {
  buildExport, exportFileName, importConfig, parseConfigFile, readToolData, reloadWith, resetToolData, serializeConfig,
} from '@/lib/configTransfer';
import { pickConfigText, saveConfigText } from '@/lib/configFile';
import MESSAGES from './configBackup.messages';

const PARSE_ERRORS = {
  notJson: 'errNotJson', wrongFormat: 'errWrongFormat', newerVersion: 'errNewerVersion', empty: 'errEmpty',
} as const;

export function ToolDataMenu({ toolId, label, compact = false }: { toolId: string; label: string; compact?: boolean }) {
  const m = useMessages(MESSAGES);
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  if (toolId === 'settings') return null;

  const exportTool = async () => {
    try {
      if (Object.keys(readToolData(toolId)).length === 0) {
        setMessage(m('noDataToExport', { tool: label }));
        return;
      }
      let appVersion: string | undefined;
      if (isTauri) {
        try { appVersion = await (await import('@tauri-apps/api/app')).getVersion(); } catch { /* optional */ }
      }
      const file = buildExport({ toolIds: [toolId], includeApp: false, appVersion });
      await saveConfigText(exportFileName([toolId], false), serializeConfig(file));
    } catch (e) {
      setMessage(m('exportFailed', { msg: e instanceof Error ? e.message : String(e) }));
    }
  };

  const importTool = async () => {
    try {
      const picked = await pickConfigText();
      if (!picked) return;
      const parsed = parseConfigFile(picked.text);
      if (!parsed.ok) { setMessage(m(PARSE_ERRORS[parsed.error])); return; }
      if (!parsed.file.tools[toolId]) { setMessage(m('toolNotInFile', { tool: label })); return; }
      // Picking the file was the confirmation; Undo is offered after the reload.
      const changed = importConfig(parsed.file, { toolIds: [toolId], includeApp: false, mode: 'replace', label });
      await reloadWith({ kind: 'import', label, changed });
    } catch (e) {
      setMessage(m('errRead', { msg: e instanceof Error ? e.message : String(e) }));
    }
  };

  const entries = confirmReset ? Object.keys(readToolData(toolId)).length : 0;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          title={m('menuLabel', { tool: label })}
          aria-label={m('menuLabel', { tool: label })}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-sm text-fg-mute/70 transition-colors hover:bg-sunk hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
            compact ? 'h-6 w-6' : 'h-ctl w-ctl',
          )}
        >
          <MoreHorizontal className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 p-1.5">
          <DropdownMenuLabel>{m('menuLabel', { tool: label })}</DropdownMenuLabel>
          <DropdownMenuItem icon={<Download className="h-3.5 w-3.5" />} onClick={() => void exportTool()}>
            {m('menuExport', { tool: label })}
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Upload className="h-3.5 w-3.5" />} onClick={() => void importTool()}>
            {m('menuImport', { tool: label })}
          </DropdownMenuItem>
          <DropdownMenuItem icon={<RotateCcw className="h-3.5 w-3.5" />} danger onClick={() => setConfirmReset(true)}>
            {m('menuReset', { tool: label })}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<ArchiveRestore className="h-3.5 w-3.5" />} onClick={() => navigate('/settings', { state: { section: 'backup' } })}>
            {m('menuBackup')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={m('resetTitle', { tool: label })}
        description={m('resetBody', { tool: label, n: entries })}
        confirmLabel={m('resetConfirm')}
        onConfirm={async () => {
          const reset = m('labelReset', { tool: label });
          const changed = resetToolData(toolId, reset);
          await reloadWith({ kind: 'reset', label: reset, changed });
        }}
      />

      <Dialog open={message !== null} onOpenChange={(o) => { if (!o) setMessage(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{m('menuLabel', { tool: label })}</DialogTitle>
            <DialogDescription>{message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setMessage(null)} autoFocus>{m('close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
