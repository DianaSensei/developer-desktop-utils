// The Compose step's editor: several values out of the previous step's
// output (or written out, or taken from an earlier step), each with its own
// label and transforms, joined into one string — the string a gateway signs,
// typically followed by an HMAC step. Execution lives in pipelineEngine.ts.

import { useMemo } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { IconButton } from '@/components/ui/icon-button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from '@/components/tools/EncodeHashEncrypt.messages';
import {
  HASH_ALGORITHMS, PART_OPS, PIPELINE_CODECS, flattenJson,
  type ComposePart, type ComposeSource, type PipelineStep, type StepOp,
} from './pipelineEngine';

const SOURCES: ComposeSource[] = ['json-path', 'regex', 'text', 'step'];

// Radix Select has no empty-string item, so "no separator" needs a stand-in.
const NO_SEP = '__none';
const SEPARATORS = ['&', '|', '\n', ',', NO_SEP] as const;

const SELECT_CLS = 'h-ctl text-xs rounded-sm';

/** `data.items[0].amount` → `amount`: the label a payload field is usually signed under. */
export function labelFromPath(path: string): string {
  return path.replace(/\[[^\]]*\]/g, '').split('.').filter(Boolean).pop() ?? path;
}

interface ComposeSectionProps {
  step: PipelineStep;
  /** The previous step's output — what JSON path and regex parts read. */
  input: string | undefined;
  /** Steps before this one, which a `step` part may read. */
  priorSteps: { id: string; label: string }[];
  onUpdate: (patch: Partial<PipelineStep>) => void;
  makeId: () => string;
  defaultsFor: (op: StepOp) => Partial<PipelineStep>;
}

export function ComposeSection({ step, input, priorSteps, onUpdate, makeId, defaultsFor }: ComposeSectionProps) {
  const t = useMessages(MESSAGES);
  const parts = step.composeParts ?? [];
  const separator = step.jsonSeparator ?? '&';

  // Fields of the incoming JSON, for one-click parts. Only an object or array
  // has fields worth listing.
  const inputFields = useMemo(() => {
    if (!input?.trim()) return [];
    try {
      const parsed: unknown = JSON.parse(input);
      return parsed !== null && typeof parsed === 'object' ? Object.keys(flattenJson(parsed)) : [];
    } catch { return []; }
  }, [input]);

  const setParts = (next: ComposePart[]) => onUpdate({ composeParts: next });
  const updatePart = (id: string, patch: Partial<ComposePart>) =>
    setParts(parts.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const movePart = (index: number, dir: -1 | 1) => {
    const swap = index + dir;
    if (swap < 0 || swap >= parts.length) return;
    const next = [...parts];
    [next[index], next[swap]] = [next[swap], next[index]];
    setParts(next);
  };
  const addPart = (part: Omit<ComposePart, 'id'>) => setParts([...parts, { id: makeId(), ...part }]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-fg-mute font-medium">{t('sep')}</span>
          <Select value={separator === '' ? NO_SEP : separator} onValueChange={(v) => onUpdate({ jsonSeparator: v === NO_SEP ? '' : v })}>
            <SelectTrigger className={cn(SELECT_CLS, 'w-44')} aria-label={t('sep')}><SelectValue /></SelectTrigger>
            <SelectContent>
              {SEPARATORS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === NO_SEP ? t('compose.sepNone') : t(s === '\n' ? 'sep.newline' : (`sep.${s}` as 'sep.&'))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-fg-mute font-medium">{t('format')}</span>
          <Segmented
            value={step.jsonFormat ?? 'key=value'}
            onValueChange={(v) => onUpdate({ jsonFormat: v })}
            size="sm"
            options={[{ value: 'key=value', label: 'label=value' }, { value: 'value', label: t('valueOnly') }]}
            aria-label={t('format')}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-fg-mute font-medium">{t('sort')}</span>
          <Segmented
            value={step.jsonSort ?? 'none'}
            onValueChange={(v) => onUpdate({ jsonSort: v })}
            size="sm"
            options={[{ value: 'none', label: t('sortNone') }, { value: 'asc', label: 'A→Z' }, { value: 'desc', label: 'Z→A' }]}
            aria-label={t('sort')}
          />
        </div>
      </div>

      {parts.length > 0 ? (
        <div className="rounded-lg border border-line divide-y divide-line-soft">
          {parts.map((part, i) => (
            <PartRow
              key={part.id}
              part={part}
              isFirst={i === 0}
              isLast={i === parts.length - 1}
              priorSteps={priorSteps}
              onChange={(patch) => updatePart(part.id, patch)}
              onRemove={() => setParts(parts.filter((p) => p.id !== part.id))}
              onMove={(dir) => movePart(i, dir)}
              makeId={makeId}
              defaultsFor={defaultsFor}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-fg-mute">{t('compose.noParts')}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => addPart({ enabled: true, source: 'text', value: '', label: '' })}
          className="flex items-center gap-1.5 text-xs text-fg-mute hover:text-fg transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />{t('compose.addPart')}
        </button>
        {inputFields.length > 0 && (
          // Keyed on the count so the picker resets to its placeholder after each pick.
          <Select
            key={parts.length}
            onValueChange={(path) => addPart({ enabled: true, source: 'json-path', value: path, label: labelFromPath(path) })}
          >
            <SelectTrigger className={cn(SELECT_CLS, 'w-56')} aria-label={t('compose.addFromInput')}>
              <SelectValue placeholder={t('compose.addFromInput')} />
            </SelectTrigger>
            <SelectContent>
              {inputFields.map((f) => <SelectItem key={f} value={f}><span className="font-mono">{f}</span></SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

// ─── One part ──────────────────────────────────────────────────────────────────

interface PartRowProps {
  part: ComposePart;
  isFirst: boolean;
  isLast: boolean;
  priorSteps: { id: string; label: string }[];
  onChange: (patch: Partial<ComposePart>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  makeId: () => string;
  defaultsFor: (op: StepOp) => Partial<PipelineStep>;
}

function PartRow({ part, isFirst, isLast, priorSteps, onChange, onRemove, onMove, makeId, defaultsFor }: PartRowProps) {
  const t = useMessages(MESSAGES);
  const subs = part.steps ?? [];
  const setSubs = (next: PipelineStep[]) => onChange({ steps: next });
  const stepGone = part.source === 'step' && !!part.value && !priorSteps.some((s) => s.id === part.value);

  return (
    <div className={cn('px-3 py-2 space-y-1.5', !part.enabled && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-2">
        <Switch checked={part.enabled} onCheckedChange={(v) => onChange({ enabled: v })} aria-label={t('compose.enablePart')} />
        <Input
          value={part.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder={t('compose.label')}
          title={t('compose.labelHint')}
          aria-label={t('compose.label')}
          className="h-ctl w-28 text-xs font-mono"
          spellCheck={false}
        />
        <Select value={part.source} onValueChange={(v) => onChange({ source: v as ComposeSource, value: '' })}>
          <SelectTrigger className={cn(SELECT_CLS, 'w-32')} aria-label={t('compose.source')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SOURCES.map((s) => <SelectItem key={s} value={s}>{t(`compose.source.${s}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex-1 min-w-[140px]">
          {part.source === 'step' ? (
            <Select value={stepGone ? undefined : part.value || undefined} onValueChange={(v) => onChange({ value: v })}>
              <SelectTrigger className={cn(SELECT_CLS, 'w-full', stepGone && 'border-warn-edge')} aria-label={t('compose.source.step')}>
                <SelectValue placeholder={stepGone ? t('compose.stepGone') : t('compose.pickStep')} />
              </SelectTrigger>
              <SelectContent>
                {priorSteps.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={part.value}
              onChange={(e) => onChange({ value: e.target.value })}
              placeholder={t(`compose.placeholder.${part.source}`)}
              aria-label={t(`compose.source.${part.source}`)}
              className="h-ctl text-xs font-mono"
              spellCheck={false}
            />
          )}
        </div>
        <div className="flex items-center gap-px">
          <IconButton size="xs" disabled={isFirst} onClick={() => onMove(-1)} aria-label={t('compose.movePartUp')} title={t('compose.movePartUp')}>
            <ChevronUp className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton size="xs" disabled={isLast} onClick={() => onMove(1)} aria-label={t('compose.movePartDown')} title={t('compose.movePartDown')}>
            <ChevronDown className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton size="xs" onClick={onRemove} aria-label={t('compose.removePart')} title={t('compose.removePart')} className="hover:text-bad">
            <Trash2 className="h-3 w-3" />
          </IconButton>
        </div>
      </div>

      {/* The part's own transforms, applied left to right. */}
      <div className="flex flex-wrap items-center gap-1.5 pl-11">
        {subs.map((sub) => (
          <SubStep
            key={sub.id}
            step={sub}
            onChange={(patch) => setSubs(subs.map((s) => (s.id === sub.id ? { ...s, ...patch } : s)))}
            onRemove={() => setSubs(subs.filter((s) => s.id !== sub.id))}
          />
        ))}
        <Select key={subs.length} onValueChange={(op) => setSubs([...subs, { id: makeId(), op: op as StepOp, ...defaultsFor(op as StepOp) }])}>
          <SelectTrigger className={cn(SELECT_CLS, 'h-6 w-auto gap-1 border-dashed px-2 text-fg-mute')} aria-label={t('compose.addTransform')}>
            <SelectValue placeholder={t('compose.addTransform')} />
          </SelectTrigger>
          <SelectContent>
            {PART_OPS.map((op) => <SelectItem key={op} value={op}>{t(`op.${op}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ─── One transform inside a part ───────────────────────────────────────────────

function SubStep({ step, onChange, onRemove }: { step: PipelineStep; onChange: (patch: Partial<PipelineStep>) => void; onRemove: () => void }) {
  const t = useMessages(MESSAGES);
  const field = (value: string | undefined, key: keyof PipelineStep, placeholder: string, width = 'w-24') => (
    <Input
      value={value ?? ''}
      onChange={(e) => onChange({ [key]: e.target.value })}
      placeholder={placeholder}
      aria-label={placeholder}
      className={cn('h-6 px-1.5 text-[11px] font-mono', width)}
      spellCheck={false}
    />
  );
  return (
    <span className="flex items-center gap-1 rounded-md border border-line bg-bg-2/30 py-0.5 pl-2 pr-0.5">
      <span className="text-[11px] font-medium text-fg">{t(`op.${step.op}`)}</span>
      {(step.op === 'encode' || step.op === 'decode') && (
        <Select value={step.codec ?? 'base64'} onValueChange={(v) => onChange({ codec: v })}>
          <SelectTrigger className="h-6 w-28 px-1.5 text-[11px]" aria-label={t(`op.${step.op}`)}><SelectValue /></SelectTrigger>
          <SelectContent>{PIPELINE_CODECS.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
        </Select>
      )}
      {step.op === 'hash' && (
        <Select value={step.algorithm ?? 'sha256'} onValueChange={(v) => onChange({ algorithm: v })}>
          <SelectTrigger className="h-6 w-28 px-1.5 text-[11px]" aria-label={t('op.hash')}><SelectValue /></SelectTrigger>
          <SelectContent>{HASH_ALGORITHMS.map((a) => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}</SelectContent>
        </Select>
      )}
      {(step.op === 'prepend' || step.op === 'append') && field(step.text, 'text', step.op === 'prepend' ? t('textToPrepend') : t('textToAppend'), 'w-28')}
      {step.op === 'replace' && <>{field(step.find, 'find', t('find'))}→{field(step.replacement, 'replacement', t('replaceWithPlaceholder'))}</>}
      {step.op === 'json-path' && field(step.path, 'path', t('jsonPathPlaceholder'), 'w-32')}
      {step.op === 'regex-extract' && field(step.pattern, 'pattern', t('pattern'), 'w-32')}
      {step.op === 'split-pick' && <>{field(step.splitSep, 'splitSep', t('splitSep'), 'w-16')}{field(step.splitIndex, 'splitIndex', t('splitIndex'), 'w-12')}</>}
      <IconButton size="xs" onClick={onRemove} aria-label={t('compose.removeTransform')} title={t('compose.removeTransform')} className="hover:text-bad">
        <X className="h-3 w-3" />
      </IconButton>
    </span>
  );
}
