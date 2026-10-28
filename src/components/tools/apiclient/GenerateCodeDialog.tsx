// "Generate Code" modal (Bruno-style): pick a language + variant, optionally
// interpolate {{vars}}, preview the snippet, and copy it. The snippet is built
// from the same prepared request Send builds from (engine.ts's
// prepareRequest: inherited auth, pre-request scripts, merged variables), plus
// the jar cookies Send attaches — so with interpolation on it runs as-is.

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { CopyButton } from '@/components/ui/copy-button';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Callout } from '@/components/ui/callout';
import { LoadingRow } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { CodeViewer } from '@/design-system';
import { CODE_TARGETS, generateCode } from './codegen';
import type { Cookie } from './cookies';
import { errToString, type PreparedRequest } from './engine';
import { redactText } from './store';
import type { VarMap } from './types';
// Imported as `tr` because this file uses `t` as a loop variable.
import { t as tr } from './i18n';

const MASK = '••••••••';

// What must not appear in a snippet unless the user asks for it: the variable
// names whose values are secret (`vault.<key>`, secret-flagged environment
// variables) and those values themselves, for when a script copied one into
// another variable or a header.
export interface CodeSecrets {
  keys: string[];
  values: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  // Runs the shared prepare step for the active request — the same call Send
  // makes before it transmits. Null when no request is open.
  prepare: ((signal: AbortSignal) => Promise<PreparedRequest>) | null;
  secrets: CodeSecrets;
  cookieJar?: Cookie[];
}

export function GenerateCodeDialog({ open, onClose, prepare, secrets, cookieJar = [] }: Props) {
  const [lang, setLang] = useState('Shell');
  const [variant, setVariant] = useState('curl');
  const [interpolate, setInterpolate] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [prepared, setPrepared] = useState<PreparedRequest | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const target = CODE_TARGETS.find((t) => t.lang === lang) ?? CODE_TARGETS[0];

  // Real values are opt-in per opening: a switch left on from last time would
  // otherwise put secrets on screen without the user having asked again.
  useEffect(() => {
    if (!open) { setReveal(false); setPrepared(null); setFailure(null); }
  }, [open]);

  // Prepare once per opening (and again if the request or its inputs change
  // while open). Script-set variables are not persisted — only Send does that.
  // A re-prepare keeps the previous snippet on screen until the new one is in,
  // rather than blanking the pane under the user.
  useEffect(() => {
    if (!open || !prepare) return;
    const controller = new AbortController();
    prepare(controller.signal).then(
      (p) => { if (!controller.signal.aborted) { setPrepared(p); setFailure(null); } },
      (e: unknown) => { if (!controller.signal.aborted) { setPrepared(null); setFailure(errToString(e)); } },
    );
    return () => controller.abort();
  }, [open, prepare]);

  // Most requests have no script and prepare in a few ms — only show the
  // loading line for a wait the user would actually notice.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (prepared || failure || !open) { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), 300);
    return () => clearTimeout(timer);
  }, [prepared, failure, open]);

  // Both renderings, so the secrets switch only shows when it would change
  // anything — most requests use no secret at all.
  const { masked, revealed } = useMemo(() => {
    if (!prepared) return { masked: '', revealed: '' };
    const render = (vars: VarMap) =>
      generateCode(prepared.request, vars, lang, variant, interpolate, prepared.inheritedHeaders, { cookieJar });
    const maskedVars = { ...prepared.vars };
    for (const k of secrets.keys) if (Object.hasOwn(maskedVars, k)) maskedVars[k] = MASK;
    return { masked: redactText(render(maskedVars), secrets.values), revealed: render(prepared.vars) };
  }, [prepared, lang, variant, interpolate, cookieJar, secrets]);
  const usesSecrets = masked !== revealed;
  const code = reveal && usesSecrets ? revealed : masked;

  const pickLang = (l: string) => {
    setLang(l);
    const next = CODE_TARGETS.find((t) => t.lang === l);
    if (next && !next.variants.some((v) => v.id === variant)) setVariant(next.variants[0].id);
  };


  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* `viewport` + a vh floor: a snippet is the one thing in this app that
          is strictly easier to read the more width it gets (fewer forced
          wraps in a long curl line), and at max-w-4xl this dialog used a
          fraction of a large window. The floor is a *min*, not a fixed
          height, so the dialog still grows with the snippet up to
          `scrollable`'s 85vh cap rather than jumping between sizes as you
          switch language or variant. */}
      <DialogContent size="viewport" scrollable className="min-h-[60vh]">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <DialogTitle className="text-base">{tr('addr.generateCode')}</DialogTitle>
        </div>

        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Select value={lang} onValueChange={pickLang}>
            <SelectTrigger className="h-ctl w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CODE_TARGETS.map((t) => <SelectItem key={t.lang} value={t.lang}>{t.lang}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Segmented, not three hand-rolled pill buttons: this is the kit's
              mode-switch control, and the hand-rolled version's "selected"
              state (a 10%-accent tint) was far weaker than every other
              selected state in the tool. */}
          <Segmented
            value={variant}
            onValueChange={setVariant}
            size="sm"
            aria-label={tr('code.variant')}
            options={target.variants.map((v) => ({ value: v.id, label: v.label }))}
          />

          {/* Switch, not a hand-rolled role="checkbox" button — the app has no
              checkbox primitive, and every other on/off in the tool (Settings
              tab, Runner, cookie jar) is a Switch. */}
          <Label className="ml-auto flex cursor-pointer items-center gap-2 text-xs">
            {tr('code.interpolate')}
            <Switch checked={interpolate} onCheckedChange={setInterpolate} aria-label={tr('code.interpolate')} />
          </Label>
          {usesSecrets && (
            <Label className="flex cursor-pointer items-center gap-2 text-xs" title={tr('code.revealSecretsHint')}>
              {tr('code.revealSecrets')}
              <Switch checked={reveal} onCheckedChange={setReveal} aria-label={tr('code.revealSecrets')} />
            </Label>
          )}
        </div>

        {/* The same failure would cancel a Send, so say so rather than hand
            over a snippet that silently differs from what Send would do. */}
        {prepared && prepared.errors.length > 0 && (
          <Callout tone="error" size="sm" title={tr('code.scriptFailed')} className="mx-4 mb-3 whitespace-pre-wrap">
            {prepared.errors.join('\n')}
          </Callout>
        )}
        {reveal && usesSecrets && (
          <Callout tone="warning" size="sm" className="mx-4 mb-3">{tr('code.revealSecretsHint')}</Callout>
        )}

        {/* Code preview. The height floor lives on the dialog: `scrollable` gives
            no definite height, so without it this `flex-1` pane collapses to zero. */}
        <div className="relative flex min-h-0 flex-1 flex-col border-t">
          {prepared ? (
            <>
              <CodeViewer value={code} language="text" />
              <CopyButton
                value={() => code}
                title={tr('copy')}
                variant="ghost"
                size="icon"
                className="absolute right-3 top-3 h-ctl w-ctl text-fg-mute"
                iconClassName="h-4 w-4"
              />
            </>
          ) : failure ? (
            <Callout tone="error" size="sm" className="m-4">{failure}</Callout>
          ) : slow ? (
            <LoadingRow size="sm" label={tr('code.preparing')} className="m-auto" />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
