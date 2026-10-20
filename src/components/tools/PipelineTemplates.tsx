import { useMemo, useState } from 'react';
import { BookmarkPlus, FolderOpen, Trash2, Upload } from 'lucide-react';
import { usePluginSdkFor, usePluginState, useSecretState } from '@/platform';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Callout } from '@/components/ui/callout';
import { CopyButton } from '@/components/ui/copy-button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from '@/components/tools/EncodeHashEncrypt.messages';
import { SECRET_OPS, type PipelineStep } from './pipelineEngine';
import {
  BUILTIN_TEMPLATES, exportTemplates, instantiateTemplate, isBuiltin, parseTemplates,
  toTemplateSteps, upsertTemplate, type PipelineTemplate,
} from './pipelineTemplates';

/** Template id → (template step id → key). Lives in the vault, like the pipeline's own keys. */
type TemplateKeys = Record<string, Record<string, string>>;

interface PipelineTemplatesProps {
  /** Current steps, keys included. */
  steps: PipelineStep[];
  /** Replace the pipeline. `keys` is by the new step ids. */
  onLoad: (steps: PipelineStep[], keys: Record<string, string>) => void;
  makeId: () => string;
}

export function PipelineTemplates({ steps, onLoad, makeId }: PipelineTemplatesProps) {
  const t = useMessages(MESSAGES);
  const sdk = usePluginSdkFor('base64');
  const [saved, setSaved] = usePluginState<PipelineTemplate[]>(sdk, 'pipeline:templates', []);
  const [templateKeys, setTemplateKeys] = useSecretState<TemplateKeys>(sdk, 'pipeline:template-keys', {});
  // The template the pipeline was last loaded from or saved as: Save
  // pre-fills its name, so updating a template is one click.
  const [activeId, setActiveId] = usePluginState<string>(sdk, 'pipeline:active-template', '');

  const [browseOpen, setBrowseOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [pendingLoad, setPendingLoad] = useState<PipelineTemplate | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PipelineTemplate | null>(null);

  const active = saved.find((s) => s.id === activeId) ?? BUILTIN_TEMPLATES.find((b) => b.id === activeId);
  const activeName = active && (isBuiltin(active.id) ? t((active as (typeof BUILTIN_TEMPLATES)[number]).nameKey) : active.name);

  const load = (template: PipelineTemplate) => {
    const { steps: next, idMap } = instantiateTemplate(template, makeId);
    const keys: Record<string, string> = {};
    for (const [from, key] of Object.entries(templateKeys[template.id] ?? {})) {
      if (idMap[from]) keys[idMap[from]] = key;
    }
    onLoad(next, keys);
    setActiveId(template.id);
    setBrowseOpen(false);
  };

  const requestLoad = (template: PipelineTemplate) => {
    if (steps.length === 0) load(template);
    else setPendingLoad(template);
  };

  const remove = (template: PipelineTemplate) => {
    setSaved((prev) => prev.filter((s) => s.id !== template.id));
    setTemplateKeys((prev) => {
      if (!(template.id in prev)) return prev;
      const { [template.id]: _gone, ...rest } = prev;
      return rest;
    });
    if (activeId === template.id) setActiveId('');
  };

  const save = (name: string, keepInput: boolean, includeKeys: boolean) => {
    const existing = saved.find((s) => s.name === name);
    const template: PipelineTemplate = {
      id: existing?.id ?? `tpl-${makeId()}`,
      name,
      steps: toTemplateSteps(steps, { keepInput }),
      updatedAt: Date.now(),
    };
    setSaved((prev) => upsertTemplate(prev, template));
    setTemplateKeys((prev) => {
      const keys: Record<string, string> = {};
      if (includeKeys) for (const s of steps) if (SECRET_OPS.has(s.op) && s.key) keys[s.id] = s.key;
      const { [template.id]: _old, ...rest } = prev;
      return Object.keys(keys).length > 0 ? { ...rest, [template.id]: keys } : rest;
    });
    setActiveId(template.id);
    setSaveOpen(false);
  };

  const importTemplates = (list: PipelineTemplate[]) => {
    setSaved((prev) => {
      let next = prev;
      for (const tpl of list) {
        const sameName = next.find((s) => s.name === tpl.name);
        next = upsertTemplate(next, { ...tpl, id: sameName?.id ?? (tpl.id || `tpl-${makeId()}`) });
      }
      return next;
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="h-ctl gap-1.5 text-xs" onClick={() => setBrowseOpen(true)}>
          <FolderOpen className="h-3.5 w-3.5" />{t('templates')}
        </Button>
        <Button variant="outline" size="sm" className="h-ctl gap-1.5 text-xs" disabled={steps.length === 0} onClick={() => setSaveOpen(true)}>
          <BookmarkPlus className="h-3.5 w-3.5" />{t('saveTemplate')}
        </Button>
        {activeName && (
          <span className="min-w-0 truncate text-[11px] text-fg-mute" title={activeName}>
            {t('fromTemplate', { name: activeName })}
          </span>
        )}
      </div>

      <BrowseDialog
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        saved={saved}
        templateKeys={templateKeys}
        onLoad={requestLoad}
        onDelete={setPendingDelete}
        onImport={importTemplates}
      />

      {saveOpen && (
        <SaveDialog
          onClose={() => setSaveOpen(false)}
          initialName={active && !isBuiltin(active.id) ? active.name : ''}
          saved={saved}
          hasKeys={steps.some((s) => SECRET_OPS.has(s.op) && s.key)}
          onSave={save}
        />
      )}

      <ConfirmDialog
        open={!!pendingLoad}
        onOpenChange={(open) => { if (!open) setPendingLoad(null); }}
        title={t('loadTemplateTitle')}
        description={t('loadTemplateDesc')}
        confirmLabel={t('loadTemplate')}
        destructive={false}
        onConfirm={() => { if (pendingLoad) load(pendingLoad); }}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title={t('deleteTemplateTitle')}
        description={t('deleteTemplateDesc', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('deleteTemplate')}
        onConfirm={() => { if (pendingDelete) remove(pendingDelete); }}
      />
    </>
  );
}

// ─── Browse ────────────────────────────────────────────────────────────────────

function StepChain({ steps }: { steps: PipelineStep[] }) {
  const t = useMessages(MESSAGES);
  return (
    <p className="text-[11px] text-fg-mute truncate">
      {steps.map((s) => t(`op.${s.op}`)).join(' → ')}
    </p>
  );
}

interface BrowseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saved: PipelineTemplate[];
  templateKeys: TemplateKeys;
  onLoad: (template: PipelineTemplate) => void;
  onDelete: (template: PipelineTemplate) => void;
  onImport: (list: PipelineTemplate[]) => void;
}

function BrowseDialog({ open, onOpenChange, saved, templateKeys, onLoad, onDelete, onImport }: BrowseDialogProps) {
  const t = useMessages(MESSAGES);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const doImport = () => {
    try {
      onImport(parseTemplates(importText));
      setImportText('');
      setImportError(null);
      setImporting(false);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  };

  const row = (tpl: PipelineTemplate, title: string, desc?: string) => (
    <div key={tpl.id} className="group/tpl flex items-center gap-2 rounded-md px-2 py-2 hover:bg-bg-2/40 transition-colors">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
          <span className="truncate">{title}</span>
          {templateKeys[tpl.id] && (
            <span className="shrink-0 rounded-xs border border-line px-1 text-[11px] font-normal text-fg-mute">{t('withKeys')}</span>
          )}
        </p>
        {desc && <p className="text-[11px] text-fg-mute">{desc}</p>}
        <StepChain steps={tpl.steps} />
      </div>
      <Button size="sm" variant="outline" className="h-ctl shrink-0 text-xs" onClick={() => onLoad(tpl)}>
        {t('loadTemplate')}
      </Button>
      {!isBuiltin(tpl.id) && (
        <button type="button" onClick={() => onDelete(tpl)}
          aria-label={t('deleteTemplate')} title={t('deleteTemplate')}
          className="h-6 w-6 shrink-0 rounded flex items-center justify-center text-fg-mute hover:text-bad transition-colors focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" scrollable>
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{t('templates')}</DialogTitle>
          <DialogDescription>{t('templatesDesc')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 space-y-4">
          <section>
            <p className="px-2 pb-1 text-[11px] font-semibold text-fg-mute uppercase tracking-wide">{t('savedTemplates')}</p>
            {saved.length === 0
              ? <p className="px-2 py-2 text-xs text-fg-mute">{t('noTemplates')}</p>
              : saved.map((tpl) => row(tpl, tpl.name))}
          </section>
          <section>
            <p className="px-2 pb-1 text-[11px] font-semibold text-fg-mute uppercase tracking-wide">{t('exampleTemplates')}</p>
            {BUILTIN_TEMPLATES.map((tpl) => row(tpl, t(tpl.nameKey), t(tpl.descKey)))}
          </section>
          {importing && (
            <section className="px-2 space-y-2">
              <Textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={t('importPlaceholder')}
                className="min-h-[110px] font-mono text-xs resize-y"
                spellCheck={false}
              />
              {importError && <Callout tone="error" size="sm">{importError}</Callout>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" className="h-ctl text-xs" onClick={() => { setImporting(false); setImportError(null); }}>
                  {t('cancel')}
                </Button>
                <Button size="sm" className="h-ctl text-xs" disabled={!importText.trim()} onClick={doImport}>
                  {t('importTemplates')}
                </Button>
              </div>
            </section>
          )}
        </div>
        <DialogFooter className="px-6 pb-6 pt-2 sm:justify-start gap-2">
          <CopyButton
            value={() => exportTemplates(saved)}
            disabled={saved.length === 0}
            label={t('exportTemplates')}
            variant="outline"
            size="sm"
            className="h-ctl text-xs"
          />
          {!importing && (
            <Button variant="outline" size="sm" className="h-ctl gap-1.5 text-xs" onClick={() => setImporting(true)}>
              <Upload className="h-3.5 w-3.5" />{t('importTemplates')}
            </Button>
          )}
          <span className="text-[11px] text-fg-mute self-center">{t('exportNoKeys')}</span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Save ──────────────────────────────────────────────────────────────────────

interface SaveDialogProps {
  onClose: () => void;
  initialName: string;
  saved: PipelineTemplate[];
  hasKeys: boolean;
  onSave: (name: string, keepInput: boolean, includeKeys: boolean) => void;
}

function SaveDialog({ onClose, initialName, saved, hasKeys, onSave }: SaveDialogProps) {
  const t = useMessages(MESSAGES);
  const [name, setName] = useState(initialName);
  const [keepInput, setKeepInput] = useState(false);
  const [includeKeys, setIncludeKeys] = useState(false);
  const trimmed = name.trim();
  const overwrites = useMemo(() => saved.some((s) => s.name === trimmed), [saved, trimmed]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('saveTemplate')}</DialogTitle>
          <DialogDescription>{t('saveTemplateDesc')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); if (trimmed) onSave(trimmed, keepInput, hasKeys && includeKeys); }}
        >
          <div className="space-y-1">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('templateName')} className="h-ctl text-sm" />
            {overwrites && <p className="text-[11px] text-warn">{t('overwritesTemplate')}</p>}
          </div>
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <Checkbox size="sm" checked={keepInput} onCheckedChange={setKeepInput} className="mt-0.5" />
            <span>{t('keepInput')}</span>
          </label>
          <label className={cn('flex items-start gap-2 text-xs', hasKeys ? 'cursor-pointer' : 'opacity-50')}>
            <Checkbox size="sm" checked={hasKeys && includeKeys} onCheckedChange={setIncludeKeys} disabled={!hasKeys} className="mt-0.5" />
            <span>
              {t('includeKeys')}
              <span className="block text-[11px] text-fg-mute">{t('includeKeysHint')}</span>
            </span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
            <Button type="submit" disabled={!trimmed}>{overwrites ? t('overwrite') : t('save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
