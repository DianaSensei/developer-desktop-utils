import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ToggleChip } from '@/components/ui/toggle-chip';
import { usePluginSdkFor, usePluginState, useSecretState } from '@/platform';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Spinner } from '@/components/ui/spinner';
import { JsonEditor } from '@/design-system';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus, Trash2, Eye, EyeOff, ChevronDown, ChevronUp,
  Hash, KeyRound, Code2, Type, Scissors, Search, CornerDownRight,
  AlertTriangle, CheckCircle2, ArrowRight, FileText, Braces,
  Lock, LockOpen, ScanText, ShieldCheck, Stamp, TextSearch, Split, Route, Combine,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuickPaste } from '@/hooks/useQuickPaste';
import { useMessages } from '@/contexts/LocaleContext';
import COMMON from '@/components/tools/common.messages';
import MESSAGES from '@/components/tools/EncodeHashEncrypt.messages';
import {
  ENCRYPT_ALGOS, HASH_ALGORITHMS, HMAC_ALGORITHMS, JWS_ALGORITHMS, JWT_ALGORITHMS,
  KEY_REQUIRED, PIPELINE_CODECS, SECRET_OPS, STEP_FAILED, StepCache,
  executePipeline, flattenJson,
  type DigestFormat, type FieldConfig, type JwtPart, type PipelineStep, type StepOp, type StepResult,
} from './pipelineEngine';
import { SECRET_ENCODINGS, isAsymmetric, isHmac, type AlgorithmSpec, type JwtAlgorithm, type SecretEncoding } from './jwt/jwtCrypto';
import type { EncryptAlgo } from './encodeCore';
import { PipelineTemplateBar } from './PipelineTemplateBar';
import { ComposeSection } from './PipelineCompose';

export { compareCodeUnits } from './pipelineEngine';

// ─── Operation metadata ────────────────────────────────────────────────────────

interface OpMeta { icon: React.ElementType; color: string; }

const OP_META: Record<StepOp, OpMeta> = {
  'text-sunk':     { icon: FileText,        color: 'text-[var(--cat-4)]' },
  'json-input':    { icon: Braces,          color: 'text-[var(--cat-4)]' },
  encode:          { icon: Code2,           color: 'text-[var(--cat-5)]' },
  decode:          { icon: Code2,           color: 'text-[var(--cat-5)]' },
  hash:            { icon: Hash,            color: 'text-[var(--cat-3)]' },
  hmac:            { icon: KeyRound,        color: 'text-[var(--cat-3)]' },
  encrypt:         { icon: Lock,            color: 'text-[var(--cat-3)]' },
  decrypt:         { icon: LockOpen,        color: 'text-[var(--cat-3)]' },
  'jwt-decode':    { icon: ScanText,        color: 'text-[var(--cat-2)]' },
  'jwt-sign':      { icon: Stamp,           color: 'text-[var(--cat-2)]' },
  'jwt-verify':    { icon: ShieldCheck,     color: 'text-[var(--cat-2)]' },
  'jws-sign':      { icon: Stamp,           color: 'text-[var(--cat-2)]' },
  'jws-verify':    { icon: ShieldCheck,     color: 'text-[var(--cat-2)]' },
  'json-path':     { icon: Route,           color: 'text-[var(--cat-1)]' },
  'regex-extract': { icon: TextSearch,      color: 'text-[var(--cat-1)]' },
  'split-pick':    { icon: Split,           color: 'text-[var(--cat-1)]' },
  compose:         { icon: Combine,         color: 'text-[var(--cat-1)]' },
  uppercase:      { icon: Type,            color: 'text-fg-mute' },
  lowercase:       { icon: Type,            color: 'text-fg-mute' },
  trim:            { icon: Scissors,        color: 'text-fg-mute' },
  prepend:         { icon: CornerDownRight, color: 'text-fg-mute' },
  append:          { icon: CornerDownRight, color: 'text-fg-mute' },
  replace:         { icon: Search,          color: 'text-fg-mute' },
  'json-format':   { icon: Braces,          color: 'text-fg-mute' },
};

const OP_GROUPS: { label: 'Input' | 'Encode' | 'Crypto' | 'JWT' | 'Extract' | 'Transform'; ops: StepOp[] }[] = [
  { label: 'Input',     ops: ['text-sunk', 'json-input'] },
  { label: 'Encode',    ops: ['encode', 'decode'] },
  { label: 'Crypto',    ops: ['hash', 'hmac', 'encrypt', 'decrypt'] },
  { label: 'JWT',       ops: ['jwt-decode', 'jwt-sign', 'jwt-verify', 'jws-sign', 'jws-verify'] },
  { label: 'Extract',   ops: ['json-path', 'regex-extract', 'split-pick', 'compose'] },
  { label: 'Transform', ops: ['uppercase', 'lowercase', 'trim', 'prepend', 'append', 'replace', 'json-format'] },
];

const SEP_OPTIONS = [
  { id: '&',  label: '& — query string' },
  { id: '|',  label: '| — pipe'         },
  { id: '\n', label: '↵ — newline'       },
  { id: ',',  label: ', — comma'         },
];

const DIGEST_OPTIONS: { value: DigestFormat; label: string }[] = [
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' },
  { value: 'base64url', label: 'Base64 URL' },
];

// ─── JSON field merge ──────────────────────────────────────────────────────────

/**
 * Sync json-type field rows with a new flat map:
 * - Remove json rows whose key is gone from the flat map
 * - Preserve all custom rows (untouched)
 * - Append new flat map keys not yet in the list
 * - Preserve ordering of surviving rows
 */
function mergeJsonFields(existing: FieldConfig[], flatMap: Record<string, string>): FieldConfig[] {
  const flatKeys = new Set(Object.keys(flatMap));
  const kept = existing.filter((f) => f.type === 'custom' || flatKeys.has(f.key));
  const seen = new Set(kept.filter((f) => f.type === 'json').map((f) => f.key));
  const fresh = Object.keys(flatMap)
    .filter((k) => !seen.has(k))
    .map((k): FieldConfig => ({ id: makeId(), type: 'json', key: k, enabled: true }));
  return [...kept, ...fresh];
}

// ─── Errors ────────────────────────────────────────────────────────────────────

function errorText(error: string, t: (k: 'secretKeyRequired' | 'stepFailed') => string) {
  return error === KEY_REQUIRED ? t('secretKeyRequired') : error === STEP_FAILED ? t('stepFailed') : error;
}

// ─── ID helper ─────────────────────────────────────────────────────────────────

// Web Crypto rather than Math.random(): only for unique step ids, but
// static analyzers flag Math.random().
function makeId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(36)).join('').slice(0, 7);
}

// ─── Shared tiny components ────────────────────────────────────────────────────

function HexToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const t = useMessages(MESSAGES);
  return (
    <ToggleChip
      pressed={value}
      onPressedChange={onChange}
      className="px-2 font-mono"
      title={t('uppercaseHex')}
      aria-label={t('uppercaseHex')}
    >
      {value ? 'ABC' : 'abc'}
    </ToggleChip>
  );
}

function CopyBtn({ value, mini = false }: { value: string; mini?: boolean }) {
  const c = useMessages(COMMON);
  return (
    <CopyButton
      value={value}
      disabled={!value}
      label={mini ? undefined : c('copy')}
      variant="ghost"
      size="sm"
      className={cn(
        'h-auto rounded-md font-medium text-fg-mute',
        mini ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs',
      )}
      iconClassName="h-3 w-3"
    />
  );
}

function OutputText({ value }: { value: string }) {
  const t = useMessages(MESSAGES);
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 160;
  const long = value.length > LIMIT;
  return (
    <span className="break-all">
      {long && !expanded ? value.slice(0, LIMIT) : value}
      {long && (
        <button type="button" onClick={() => setExpanded((v) => !v)}
          className="ml-1 text-acc text-[11px] font-sans underline underline-offset-2">
          {expanded ? t('less') : t('more', { n: value.length - LIMIT })}
        </button>
      )}
    </span>
  );
}

// ─── Field row (unified — json & custom in one list) ──────────────────────────

interface FieldRowProps {
  field: FieldConfig;
  flatMap: Record<string, string> | null; // live flattened JSON for preview
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<FieldConfig>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}

function FieldRow({ field, flatMap, isFirst, isLast, onChange, onRemove, onMove }: FieldRowProps) {
  const t = useMessages(MESSAGES);
  const jsonVal = flatMap && field.type === 'json' ? flatMap[field.key] : undefined;
  const missing = field.type === 'json' && flatMap !== null && !(field.key in (flatMap ?? {}));

  return (
    <div className="flex items-center gap-2 py-1.5 group/row">
      {/* Checkbox */}
      <button
        type="button"
        onClick={() => onChange({ enabled: !field.enabled })}
        className={cn(
          'shrink-0 h-4 w-4 rounded border transition-colors flex items-center justify-center',
          field.enabled ? 'bg-acc border-acc' : 'border-line bg-card'
        )}
      >
        {field.enabled && <span className="text-[11px] font-bold text-acc-fg leading-none">✓</span>}
      </button>

      {/* Key */}
      <div className="w-36 shrink-0">
        {field.type === 'custom' ? (
          <Input
            value={field.key}
            onChange={(e) => {
              const k = e.target.value;
              onChange({ key: k, enabled: k.length > 0 });
            }}
            placeholder={t('key')}
            className="h-ctl text-xs font-mono"
          />
        ) : (
          <div className={cn('flex items-center gap-1.5 min-w-0', !field.enabled && 'opacity-40')}>
            <span className="text-xs font-mono font-medium text-fg truncate">{field.key}</span>
            {missing && (
              <span className="shrink-0 rounded-xs border border-warn-edge bg-warn-tint px-1 py-px text-[11px] font-medium leading-none text-warn">
                missing
              </span>
            )}
          </div>
        )}
      </div>

      {/* Value */}
      <div className="flex-1 min-w-0">
        {field.type === 'custom' ? (
          <Input
            value={field.customValue ?? ''}
            onChange={(e) => onChange({ customValue: e.target.value })}
            placeholder={t('value')}
            className="h-ctl text-xs font-mono"
          />
        ) : (
          <span className={cn(
            'block text-xs font-mono truncate',
            field.enabled ? 'text-fg-mute' : 'text-fg-mute/30',
            missing && 'text-fg-mute/30 italic'
          )}>
            {jsonVal != null ? jsonVal : '—'}
          </span>
        )}
      </div>

      {/* Move / delete — visible on row hover */}
      {/* focus-within keeps these reachable by keyboard — hover alone would leave
          them invisible to anyone tabbing through the row. */}
      <div className="shrink-0 flex items-center gap-px opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
        <button type="button" disabled={isFirst} onClick={() => onMove(-1)}
          aria-label={t('moveFieldUp')} title={t('moveFieldUp')}
          className="h-6 w-6 rounded flex items-center justify-center text-fg-mute hover:text-fg disabled:opacity-20 transition-colors focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus">
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button type="button" disabled={isLast} onClick={() => onMove(1)}
          aria-label={t('moveFieldDown')} title={t('moveFieldDown')}
          className="h-6 w-6 rounded flex items-center justify-center text-fg-mute hover:text-fg disabled:opacity-20 transition-colors focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus">
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {field.type === 'custom' && (
          <button type="button" onClick={onRemove}
            aria-label={t('removeField')} title={t('removeField')}
            className="h-6 w-6 rounded flex items-center justify-center text-fg-mute hover:text-bad transition-colors focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus">
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── JSON Input section (the entire first-step content) ───────────────────────

interface JsonInputSectionProps {
  jsonText: string;
  jsonFields: FieldConfig[];
  jsonSeparator: string;
  jsonSort: 'none' | 'asc' | 'desc';
  jsonFormat: 'key=value' | 'value';
  onJsonTextChange: (text: string) => void;
  onFieldsChange: (fields: FieldConfig[]) => void;
  onUpdate: (patch: Partial<PipelineStep>) => void;
}

function JsonInputSection({
  jsonText, jsonFields, jsonSeparator, jsonSort, jsonFormat,
  onJsonTextChange, onFieldsChange, onUpdate,
}: JsonInputSectionProps) {
  const t = useMessages(MESSAGES);
  // Flat map for the field-value preview column
  const flatMap = useMemo<Record<string, string> | null>(() => {
    if (!jsonText.trim()) return null;
    try { return flattenJson(JSON.parse(jsonText)); }
    catch { return null; }
  }, [jsonText]);

  const jsonError = useMemo(() => {
    if (!jsonText.trim()) return null;
    try { JSON.parse(jsonText); return null; }
    catch (e) { return e instanceof Error ? e.message : t('invalidJson'); }
  }, [jsonText]);

  const handleJsonChange = (text: string) => {
    let merged = jsonFields;
    if (!text.trim()) {
      // Cleared — remove all JSON rows, keep custom
      merged = jsonFields.filter((f) => f.type === 'custom');
    } else {
      try {
        merged = mergeJsonFields(jsonFields, flattenJson(JSON.parse(text)));
      } catch { /* invalid mid-edit — keep current rows */ }
    }
    onJsonTextChange(text);
    if (merged !== jsonFields) onFieldsChange(merged);
  };

  const updateField = (id: string, patch: Partial<FieldConfig>) =>
    onFieldsChange(jsonFields.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const removeField = (id: string) =>
    onFieldsChange(jsonFields.filter((f) => f.id !== id));

  const moveField = (id: string, dir: -1 | 1) => {
    const idx = jsonFields.findIndex((f) => f.id === id);
    if (idx < 0) return;
    const next = [...jsonFields];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onFieldsChange(next);
  };

  const addCustomField = () =>
    onFieldsChange([...jsonFields, { id: makeId(), type: 'custom', key: '', customValue: '', enabled: false }]);

  return (
    <div className="space-y-3">
      {/* ── JSON editor ── */}
      <div className="relative">
        <JsonEditor
          value={jsonText}
          onChange={handleJsonChange}
          placeholder={t('pasteJson')}
          className={cn('min-h-[110px]', jsonError && jsonText.trim() && 'border-warn-edge')}
        />
        {/* Validity badge */}
        {jsonText.trim() && (
          <div className="absolute top-2 right-2 pointer-events-none">
            {jsonError
              ? <span className="flex items-center gap-1 rounded-xs border border-warn-edge bg-warn-tint px-1.5 py-0.5 text-[11px] text-warn">
                  <AlertTriangle className="h-2.5 w-2.5" />Invalid
                </span>
              : <span className="flex items-center gap-1 rounded-xs border border-ok-edge bg-ok-tint px-1.5 py-0.5 text-[11px] text-ok">
                  <CheckCircle2 className="h-2.5 w-2.5" />Valid
                </span>
            }
          </div>
        )}
      </div>

      {/* ── Output options ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-fg-mute font-medium">{t('sep')}</span>
          <Select value={jsonSeparator} onValueChange={(v) => onUpdate({ jsonSeparator: v })}>
            <SelectTrigger className="h-ctl w-36 text-xs rounded-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SEP_OPTIONS.map((s) => <SelectItem key={s.id} value={s.id}>{t(s.id === '\n' ? 'sep.newline' : (`sep.${s.id}` as 'sep.&'))}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-fg-mute font-medium">{t('format')}</span>
          <Segmented
            value={jsonFormat}
            onValueChange={(v) => onUpdate({ jsonFormat: v })}
            size="sm"
            options={[
              { value: 'key=value', label: 'key=value' },
              { value: 'value', label: t('valueOnly') },
            ]}
            aria-label={t('jsonFormat')}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-fg-mute font-medium">{t('sort')}</span>
          <Segmented
            value={jsonSort}
            onValueChange={(v) => onUpdate({ jsonSort: v })}
            size="sm"
            options={[
              { value: 'none', label: t('sortNone') },
              { value: 'asc', label: 'A→Z' },
              { value: 'desc', label: 'Z→A' },
            ]}
            aria-label={t('jsonSort')}
          />
        </div>
      </div>

      {/* ── Unified field table ── */}
      {jsonFields.length > 0 && (
        <div className="rounded-lg border border-line overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-2/30 border-b border-line">
            <div className="w-4" />
            <span className="w-36 shrink-0 text-[11px] font-semibold text-fg-mute uppercase tracking-wide">{t('field')}</span>
            <span className="flex-1 text-[11px] font-semibold text-fg-mute uppercase tracking-wide">{t('value')}</span>
          </div>
          {/* Rows */}
          <div className="px-3 divide-y divide-line-soft">
            {jsonFields.map((field, i) => (
              <FieldRow
                key={field.id}
                field={field}
                flatMap={flatMap}
                isFirst={i === 0}
                isLast={i === jsonFields.length - 1}
                onChange={(patch) => updateField(field.id, patch)}
                onRemove={() => removeField(field.id)}
                onMove={(dir) => moveField(field.id, dir)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Add custom field */}
      <button
        type="button" onClick={addCustomField}
        className="flex items-center gap-1.5 text-xs text-fg-mute hover:text-fg transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        {t('addCustomField')}
      </button>
    </div>
  );
}

// ─── Step output bar ───────────────────────────────────────────────────────────

function StepOutputBar({ result }: { result: StepResult | undefined }) {
  const t = useMessages(MESSAGES);
  if (!result) return null;
  return (
    <div className={cn(
      'flex items-start gap-2 px-3 py-2 border-t text-xs font-mono',
      result.error
        ? 'bg-bad/5 border-bad/20 text-bad'
        : 'bg-bg-2/20 border-line-soft text-fg-mute'
    )}>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 mt-px text-fg-mute/50" />
      <span className="flex-1 min-w-0">
        {result.error
          ? <span className="flex items-center gap-1.5"><AlertTriangle className="h-3 w-3 shrink-0" />{errorText(result.error, t)}</span>
          : result.output
            ? <OutputText value={result.output} />
            : <span className="opacity-30 italic">—</span>
        }
      </span>
      {!result.error && result.output && <CopyBtn value={result.output} mini />}
    </div>
  );
}


// ─── Step parameter controls ───────────────────────────────────────────────────

const SELECT_CLS = 'h-ctl text-xs rounded-sm';

function ParamLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] text-fg-mute font-medium">{children}</span>;
}

function DigestControls({ step, onUpdate }: { step: PipelineStep; onUpdate: (patch: Partial<PipelineStep>) => void }) {
  const t = useMessages(MESSAGES);
  const digest = step.digest ?? 'hex';
  return (
    <>
      <div className="flex items-center gap-1.5">
        <ParamLabel>{t('digest')}</ParamLabel>
        <Select value={digest} onValueChange={(v) => onUpdate({ digest: v as DigestFormat })}>
          <SelectTrigger className={cn(SELECT_CLS, 'w-32')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {DIGEST_OPTIONS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {digest === 'hex' && <HexToggle value={!!step.upperHex} onChange={(v) => onUpdate({ upperHex: v })} />}
    </>
  );
}

function KeyEncodingSelect({ value, onChange }: { value: SecretEncoding; onChange: (v: SecretEncoding) => void }) {
  const t = useMessages(MESSAGES);
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SecretEncoding)}>
      <SelectTrigger className={cn(SELECT_CLS, 'w-28 shrink-0')} aria-label={t('keyEncoding')} title={t('keyEncoding')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SECRET_ENCODINGS.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

interface KeyFieldProps {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder: string;
  /** PEM / JWK: several lines, so a textarea instead of a password box. */
  multiline?: boolean;
  /** Shown left of the box (HMAC key encoding). */
  addon?: React.ReactNode;
}

function KeyField({ value, onChange, show, onToggle, placeholder, multiline, addon }: KeyFieldProps) {
  const t = useMessages(MESSAGES);
  const eye = (
    <button
      type="button"
      onClick={onToggle}
      aria-label={show ? t('hideKey') : t('showKey')}
      title={show ? t('hideKey') : t('showKey')}
      aria-pressed={show}
      className={cn(
        'absolute right-2.5 rounded text-fg-mute transition-colors hover:text-fg focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus',
        multiline ? 'top-2' : 'top-1/2 -translate-y-1/2',
      )}
    >
      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );

  if (multiline) {
    // A textarea cannot mask its text, so a set key collapses to a summary
    // until the eye is pressed.
    return (
      <div className="relative">
        {show || !value ? (
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="min-h-[84px] pr-9 font-mono text-[11px] resize-y leading-relaxed"
            spellCheck={false}
          />
        ) : (
          <div className="flex h-ctl items-center rounded-md border border-line bg-card px-3 pr-9 text-xs text-fg-mute">
            {t('keyHidden', { n: value.length })}
          </div>
        )}
        {value && eye}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {addon}
      <div className="relative flex-1">
        <Input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-ctl pr-9 font-mono text-sm"
          autoComplete="off"
        />
        {eye}
      </div>
    </div>
  );
}

function JwtAlgSelect({ value, algorithms, onChange }: { value: JwtAlgorithm; algorithms: AlgorithmSpec[]; onChange: (v: JwtAlgorithm) => void }) {
  const families = [...new Set(algorithms.map((a) => a.familyLabel))];
  return (
    <Select value={value} onValueChange={(v) => onChange(v as JwtAlgorithm)}>
      <SelectTrigger className={cn(SELECT_CLS, 'w-32')}><SelectValue /></SelectTrigger>
      <SelectContent>
        {families.map((family) => (
          <div key={family}>
            <div className="px-2 pt-2 pb-1 text-[11px] font-semibold text-fg-mute uppercase tracking-wide">{family}</div>
            {algorithms.filter((a) => a.familyLabel === family).map((a) => (
              <SelectItem key={a.alg} value={a.alg}>{a.alg}</SelectItem>
            ))}
          </div>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Algorithm + key box for the JWT / JWS steps. The key box follows the algorithm family. */
function JwtKeyControls({ step, purpose, showKey, onToggleKey, onUpdate }: {
  step: PipelineStep;
  purpose: 'sign' | 'verify';
  showKey: boolean;
  onToggleKey: () => void;
  onUpdate: (patch: Partial<PipelineStep>) => void;
}) {
  const t = useMessages(MESSAGES);
  const isJws = step.op === 'jws-sign' || step.op === 'jws-verify';
  const alg = step.jwtAlg ?? 'HS256';
  const algorithms = isJws ? JWS_ALGORITHMS : JWT_ALGORITHMS;
  const spec = algorithms.find((a) => a.alg === alg);
  // x5c only makes sense for a certificate, i.e. an asymmetric algorithm.
  const canX5c = purpose === 'verify' && isAsymmetric(alg);
  const fromX5c = canX5c && step.keySource === 'x5c';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <JwtAlgSelect value={alg} algorithms={algorithms} onChange={(v) => onUpdate({ jwtAlg: v })} />
        {canX5c && (
          <div className="flex items-center gap-1.5">
            <ParamLabel>{t('keySource')}</ParamLabel>
            <Segmented
              value={step.keySource ?? 'key'}
              onValueChange={(v) => onUpdate(v === 'x5c' ? { keySource: v, x5cTrust: step.x5cTrust ?? 'apple' } : { keySource: v })}
              size="sm"
              options={[{ value: 'key', label: t('keySource.key') }, { value: 'x5c', label: t('keySource.x5c') }]}
              aria-label={t('keySource')}
            />
          </div>
        )}
      </div>
      {fromX5c ? (
        <X5cTrustControls step={step} onUpdate={onUpdate} />
      ) : spec && <p className="text-[11px] text-fg-mute">{spec.keyHint}</p>}
      {fromX5c ? null : alg === 'none' ? (
        <p className="flex items-center gap-1.5 text-[11px] text-warn">
          <AlertTriangle className="h-3 w-3 shrink-0" />{t('algNone')}
        </p>
      ) : isHmac(alg) ? (
        <KeyField
          value={step.key ?? ''}
          onChange={(v) => onUpdate({ key: v })}
          show={showKey}
          onToggle={onToggleKey}
          placeholder={t('secretKeyPlaceholder')}
          addon={<KeyEncodingSelect value={step.keyEncoding ?? 'utf8'} onChange={(v) => onUpdate({ keyEncoding: v })} />}
        />
      ) : isAsymmetric(alg) && (
        <KeyField
          value={step.key ?? ''}
          onChange={(v) => onUpdate({ key: v })}
          show={showKey}
          onToggle={onToggleKey}
          placeholder={purpose === 'sign' ? t('privateKeyPlaceholder') : t('publicKeyPlaceholder')}
          multiline
        />
      )}
    </div>
  );
}

/** Which root an x5c chain must end at. Apple's root is pinned in jwt/x5cChain.ts. */
function X5cTrustControls({ step, onUpdate }: { step: PipelineStep; onUpdate: (patch: Partial<PipelineStep>) => void }) {
  const t = useMessages(MESSAGES);
  const trust = step.x5cTrust ?? 'apple';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <ParamLabel>{t('x5cTrust')}</ParamLabel>
        <Segmented
          value={trust}
          onValueChange={(v) => onUpdate({ x5cTrust: v })}
          size="sm"
          options={(['apple', 'custom', 'none'] as const).map((v) => ({ value: v, label: t(`x5cTrust.${v}`) }))}
          aria-label={t('x5cTrust')}
        />
      </div>
      {trust === 'custom' && (
        <Textarea
          value={step.trustRoot ?? ''}
          onChange={(e) => onUpdate({ trustRoot: e.target.value })}
          placeholder={t('trustRootPlaceholder')}
          className="min-h-[72px] font-mono text-[11px] resize-y"
          spellCheck={false}
        />
      )}
      {trust === 'none' ? (
        <p className="flex items-start gap-1.5 text-[11px] text-warn">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-px" />{t('x5cWarning')}
        </p>
      ) : (
        <p className="text-[11px] text-fg-mute">{t(trust === 'apple' ? 'x5cAppleInfo' : 'x5cCustomInfo')}</p>
      )}
    </div>
  );
}

// ─── Step card ─────────────────────────────────────────────────────────────────

interface StepCardProps {
  step: PipelineStep;
  index: number;
  total: number;
  result: StepResult | undefined;
  /** The previous step's output (Compose lists its JSON fields). */
  input: string | undefined;
  /** Steps before this one (a Compose part may read their output). */
  priorSteps: { id: string; label: string }[];
  showKey: boolean;
  onToggleKey: () => void;
  onUpdate: (patch: Partial<PipelineStep>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function StepCard({ step, index, total, result, input, priorSteps, showKey, onToggleKey, onUpdate, onRemove, onMoveUp, onMoveDown }: StepCardProps) {
  const t = useMessages(MESSAGES);
  const keyProps = { show: showKey, onToggle: onToggleKey };
  const cipher = ENCRYPT_ALGOS.find((a) => a.id === (step.cipher ?? 'aes-gcm')) ?? ENCRYPT_ALGOS[0];

  return (
    <div className={cn(
      'rounded-lg border bg-card shadow-sm overflow-hidden',
      result?.error ? 'border-bad/30' : 'border-line'
    )}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-2/20 border-b border-line-soft">
        <div className={cn(
          'shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold',
          result?.error ? 'bg-bad/20 text-bad' : 'bg-acc/15 text-acc'
        )}>
          {index + 1}
        </div>

        <Select value={step.op} onValueChange={(v) => onUpdate({ op: v as StepOp })}>
          <SelectTrigger className="h-ctl flex-1 max-w-[200px] text-xs font-semibold border-0 bg-transparent shadow-none focus-visible:ring-0 px-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OP_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="px-2 pt-2 pb-1 text-[11px] font-semibold text-fg-mute uppercase tracking-wide">{t(`group.${group.label}`)}</div>
                {group.ops.map((op) => {
                  const m = OP_META[op];
                  return (
                    <SelectItem key={op} value={op}>
                      <span className="flex items-center gap-2">
                        <m.icon className={cn('h-3 w-3', m.color)} />{t(`op.${op}`)}
                      </span>
                    </SelectItem>
                  );
                })}
              </div>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-0.5 ml-auto">
          <button type="button" disabled={index === 0} onClick={onMoveUp}
            aria-label={t('moveStepUp')} title={t('moveStepUp')}
            className="h-6 w-6 rounded flex items-center justify-center text-fg-mute hover:text-fg disabled:opacity-20 transition-colors focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus">
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" disabled={index === total - 1} onClick={onMoveDown}
            aria-label={t('moveStepDown')} title={t('moveStepDown')}
            className="h-6 w-6 rounded flex items-center justify-center text-fg-mute hover:text-fg disabled:opacity-20 transition-colors focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onRemove}
            aria-label={t('removeStep')} title={t('removeStep')}
            className="h-6 w-6 rounded flex items-center justify-center text-fg-mute hover:text-bad transition-colors focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Params */}
      <div className="px-3 pt-3 pb-3 space-y-2.5">
        {/* Text input step */}
        {step.op === 'text-sunk' && (
          <Textarea
            value={step.textValue ?? ''}
            onChange={(e) => onUpdate({ textValue: e.target.value })}
            placeholder={t('anyText')}
            className="min-h-[90px] font-mono text-xs resize-y leading-relaxed"
            spellCheck={false}
          />
        )}

        {/* JSON input step */}
        {step.op === 'json-input' && (
          <JsonInputSection
            jsonText={step.jsonText ?? ''}
            jsonFields={step.jsonFields ?? []}
            jsonSeparator={step.jsonSeparator ?? '&'}
            jsonSort={step.jsonSort ?? 'none'}
            jsonFormat={step.jsonFormat ?? 'key=value'}
            onJsonTextChange={(text) => onUpdate({ jsonText: text })}
            onFieldsChange={(fields) => onUpdate({ jsonFields: fields })}
            onUpdate={onUpdate}
          />
        )}

        {/* Encode / Decode */}
        {(step.op === 'encode' || step.op === 'decode') && (
          <Select value={step.codec ?? 'base64'} onValueChange={(v) => onUpdate({ codec: v })}>
            <SelectTrigger className={cn(SELECT_CLS, 'w-48')}><SelectValue /></SelectTrigger>
            <SelectContent>
              {PIPELINE_CODECS.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {/* Hash */}
        {step.op === 'hash' && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={step.algorithm ?? 'sha256'} onValueChange={(v) => onUpdate({ algorithm: v })}>
              <SelectTrigger className={cn(SELECT_CLS, 'w-40')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {HASH_ALGORITHMS.map((a) => <SelectItem key={a.id} value={a.id}>{a.label} ({a.bits}-bit)</SelectItem>)}
              </SelectContent>
            </Select>
            <DigestControls step={step} onUpdate={onUpdate} />
          </div>
        )}

        {/* HMAC */}
        {step.op === 'hmac' && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={step.algorithm ?? 'sha256'} onValueChange={(v) => onUpdate({ algorithm: v })}>
                <SelectTrigger className={cn(SELECT_CLS, 'w-40')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HMAC_ALGORITHMS.map((a) => <SelectItem key={a.id} value={a.id}>{a.label} ({a.bits}-bit)</SelectItem>)}
                </SelectContent>
              </Select>
              <DigestControls step={step} onUpdate={onUpdate} />
            </div>
            <KeyField
              {...keyProps}
              value={step.key ?? ''}
              onChange={(v) => onUpdate({ key: v })}
              placeholder={t('secretKeyPlaceholder')}
              addon={<KeyEncodingSelect value={step.keyEncoding ?? 'utf8'} onChange={(v) => onUpdate({ keyEncoding: v })} />}
            />
          </div>
        )}

        {/* Encrypt / Decrypt */}
        {(step.op === 'encrypt' || step.op === 'decrypt') && (
          <div className="space-y-2">
            <Select value={cipher.id} onValueChange={(v) => onUpdate({ cipher: v as EncryptAlgo })}>
              <SelectTrigger className={cn(SELECT_CLS, 'w-44')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENCRYPT_ALGOS.map((a) => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className={cn('text-[11px]', cipher.weak ? 'text-warn' : 'text-fg-mute')}>{cipher.desc}</p>
            <KeyField
              {...keyProps}
              value={step.key ?? ''}
              onChange={(v) => onUpdate({ key: v })}
              placeholder={t('passphrasePlaceholder')}
            />
          </div>
        )}

        {/* JWT / JWS decode */}
        {step.op === 'jwt-decode' && (
          <div className="flex items-center gap-1.5">
            <ParamLabel>{t('jwtPart')}</ParamLabel>
            <Segmented
              value={step.jwtPart ?? 'payload'}
              onValueChange={(v) => onUpdate({ jwtPart: v as JwtPart })}
              size="sm"
              options={(['payload', 'header', 'signature', 'all'] as const).map((p) => ({ value: p, label: t(`part.${p}`) }))}
              aria-label={t('jwtPart')}
            />
          </div>
        )}

        {/* JWT / JWS sign */}
        {(step.op === 'jwt-sign' || step.op === 'jws-sign') && (
          <div className="space-y-2">
            <JwtKeyControls step={step} purpose="sign" showKey={showKey} onToggleKey={onToggleKey} onUpdate={onUpdate} />
            <div>
              <p className="text-[11px] text-fg-mute mb-1">{t('extraHeader')}</p>
              <Input
                value={step.jwtHeader ?? ''}
                onChange={(e) => onUpdate({ jwtHeader: e.target.value })}
                placeholder='{ "kid": "key-1" }'
                className="h-ctl text-xs font-mono"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {step.op === 'jwt-sign' ? (
                <>
                  <ToggleChip pressed={step.jwtIssuedAt ?? true} onPressedChange={(v) => onUpdate({ jwtIssuedAt: v })} className="px-2">
                    {t('issuedAt')}
                  </ToggleChip>
                  <ParamLabel>{t('expiresIn')}</ParamLabel>
                  <Input
                    value={step.jwtExpiresIn ?? ''}
                    onChange={(e) => onUpdate({ jwtExpiresIn: e.target.value })}
                    placeholder={t('expiresInPlaceholder')}
                    className="h-ctl w-28 text-xs font-mono"
                  />
                </>
              ) : (
                <ToggleChip pressed={!!step.jwsDetached} onPressedChange={(v) => onUpdate({ jwsDetached: v })} className="px-2">
                  {t('detached')}
                </ToggleChip>
              )}
            </div>
          </div>
        )}

        {/* JWT / JWS verify */}
        {(step.op === 'jwt-verify' || step.op === 'jws-verify') && (
          <div className="space-y-2">
            <JwtKeyControls step={step} purpose="verify" showKey={showKey} onToggleKey={onToggleKey} onUpdate={onUpdate} />
            {step.op === 'jws-verify' && (
              <div>
                <p className="text-[11px] text-fg-mute mb-1">{t('detachedPayload')}</p>
                <Textarea
                  value={step.detachedPayload ?? ''}
                  onChange={(e) => onUpdate({ detachedPayload: e.target.value })}
                  className="min-h-[56px] font-mono text-xs resize-y"
                  spellCheck={false}
                />
              </div>
            )}
          </div>
        )}

        {/* JSON path */}
        {step.op === 'json-path' && (
          <Input
            value={step.path ?? ''}
            onChange={(e) => onUpdate({ path: e.target.value })}
            placeholder={t('jsonPathPlaceholder')}
            className="h-ctl text-xs font-mono"
            spellCheck={false}
          />
        )}

        {/* Regex extract */}
        {step.op === 'regex-extract' && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[160px]">
              <p className="text-[11px] text-fg-mute mb-1">{t('pattern')}</p>
              <Input value={step.pattern ?? ''} onChange={(e) => onUpdate({ pattern: e.target.value })}
                placeholder="token=([^&]+)" className="h-ctl text-xs font-mono" spellCheck={false} />
            </div>
            <div className="w-16">
              <p className="text-[11px] text-fg-mute mb-1">{t('flags')}</p>
              <Input value={step.regexFlags ?? ''} onChange={(e) => onUpdate({ regexFlags: e.target.value })}
                placeholder="i" className="h-ctl text-xs font-mono" spellCheck={false} />
            </div>
            <div className="w-20">
              <p className="text-[11px] text-fg-mute mb-1">{t('captureGroup')}</p>
              <Input value={step.group ?? ''} onChange={(e) => onUpdate({ group: e.target.value })}
                placeholder={t('captureGroupPlaceholder')} className="h-ctl text-xs font-mono" spellCheck={false} />
            </div>
            <ToggleChip pressed={!!step.matchAll} onPressedChange={(v) => onUpdate({ matchAll: v })} className="px-2">
              {t('allMatches')}
            </ToggleChip>
          </div>
        )}

        {/* Split & pick */}
        {step.op === 'split-pick' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[11px] text-fg-mute mb-1">{t('splitSep')}</p>
              <Input value={step.splitSep ?? ''} onChange={(e) => onUpdate({ splitSep: e.target.value })} className="h-ctl text-xs font-mono" />
            </div>
            <div>
              <p className="text-[11px] text-fg-mute mb-1">{t('splitIndex')}</p>
              <Input value={step.splitIndex ?? ''} onChange={(e) => onUpdate({ splitIndex: e.target.value })} placeholder="0" className="h-ctl text-xs font-mono" />
            </div>
          </div>
        )}

        {/* Compose */}
        {step.op === 'compose' && (
          <ComposeSection
            step={step}
            input={input}
            priorSteps={priorSteps}
            onUpdate={onUpdate}
            makeId={makeId}
            defaultsFor={partStepDefaults}
          />
        )}

        {/* Prepend / Append */}
        {(step.op === 'prepend' || step.op === 'append') && (
          <div className="flex items-center gap-2">
            <code className="text-[11px] text-fg-mute bg-bg-2/40 border border-line rounded px-1.5 py-0.5 shrink-0 whitespace-nowrap">
              {step.op === 'prepend' ? '[text] + value' : 'value + [text]'}
            </code>
            <Input
              value={step.text ?? ''}
              onChange={(e) => onUpdate({ text: e.target.value })}
              placeholder={step.op === 'prepend' ? t('textToPrepend') : t('textToAppend')}
              className="h-ctl text-xs font-mono flex-1"
            />
          </div>
        )}

        {/* Replace */}
        {step.op === 'replace' && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[11px] text-fg-mute mb-1">{t('findAll')}</p>
                <Input value={step.find ?? ''} onChange={(e) => onUpdate({ find: e.target.value })} placeholder={t('find')} className="h-ctl text-xs font-mono" />
              </div>
              <div>
                <p className="text-[11px] text-fg-mute mb-1">{t('replaceWith')}</p>
                <Input value={step.replacement ?? ''} onChange={(e) => onUpdate({ replacement: e.target.value })} placeholder={t('replaceWithPlaceholder')} className="h-ctl text-xs font-mono" />
              </div>
            </div>
            <ToggleChip pressed={!!step.regex} onPressedChange={(v) => onUpdate({ regex: v })} className="px-2">
              {t('useRegex')}
            </ToggleChip>
          </div>
        )}

        {/* JSON format */}
        {step.op === 'json-format' && (
          <Segmented
            value={step.jsonIndent ?? 'pretty'}
            onValueChange={(v) => onUpdate({ jsonIndent: v })}
            size="sm"
            options={[{ value: 'pretty', label: t('pretty') }, { value: 'minify', label: t('minify') }]}
            aria-label={t('op.json-format')}
          />
        )}

        {/* No-param ops */}
        {(step.op === 'uppercase' || step.op === 'lowercase' || step.op === 'trim') && (
          <p className="text-xs text-fg-mute">{t(`opHint.${step.op}`)}</p>
        )}
      </div>

      <StepOutputBar result={result} />
    </div>
  );
}

// ─── Add step panel ────────────────────────────────────────────────────────────

function AddStepPanel({ onAdd }: { onAdd: (op: StepOp) => void }) {
  const t = useMessages(MESSAGES);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="w-px h-3 bg-line/50" />
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}
          className="h-ctl px-4 text-xs rounded-full border-dashed gap-1.5 text-fg-mute hover:text-fg">
          <Plus className="h-3 w-3" />{t('addStep')}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-px h-3 bg-line/50" />
      <div className="w-full rounded-lg border border-dashed border-acc/30 bg-acc/3 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">{t('addStep')}</p>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-fg-mute hover:text-fg">✕</button>
        </div>
        {OP_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-[11px] font-semibold text-fg-mute uppercase tracking-wide mb-1.5">{t(`group.${group.label}`)}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.ops.map((op) => {
                const m = OP_META[op]; const Icon = m.icon;
                return (
                  <button key={op} type="button"
                    onClick={() => { onAdd(op); setOpen(false); }}
                    title={t(`opHint.${op}`)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-card text-xs font-medium hover:border-acc/40 hover:bg-acc/5 hover:text-acc transition-all">
                    <Icon className={cn('h-3.5 w-3.5', m.color)} />{t(`op.${op}`)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Final result ──────────────────────────────────────────────────────────────

function FinalResult({ result, running }: { result: StepResult | undefined; running: boolean }) {
  const t = useMessages(MESSAGES);
  if (!result || (!result.output && !result.error)) return null;
  const ok = !!result.output && !result.error;
  return (
    <div className={cn('rounded-lg border p-4 transition-opacity', ok ? 'border-acc/25 bg-acc/5' : 'border-bad/25 bg-bad/5', running && 'opacity-60')}>
      <div className="flex items-center justify-between mb-2.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          {ok ? <CheckCircle2 className="h-4 w-4 text-acc" /> : <AlertTriangle className="h-4 w-4 text-bad" />}
          {ok ? t('finalResult') : t('pipelineError')}
          {running && <Spinner size="xs" className="ml-1 text-fg-mute" label={t('running')} />}
        </span>
        {ok && <CopyBtn value={result.output} />}
      </div>
      {ok
        ? <p className="font-mono text-sm leading-relaxed break-all whitespace-pre-wrap text-fg">{result.output}</p>
        : <p className="text-sm text-bad">{errorText(result.error ?? '', t)}</p>
      }
      {ok && <p className="text-[11px] text-fg-mute/40 mt-1.5">{t('chars', { n: result.output.length })}</p>}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

const STEP_DEFAULTS: Partial<Record<StepOp, Partial<PipelineStep>>> = {
  'text-sunk':     { textValue: '' },
  'json-input':    { jsonText: '', jsonFields: [], jsonSeparator: '&', jsonSort: 'none', jsonFormat: 'key=value' },
  hmac:            { algorithm: 'sha256', upperHex: false, digest: 'hex', keyEncoding: 'utf8' },
  hash:            { algorithm: 'sha256', upperHex: false, digest: 'hex' },
  encode:          { codec: 'base64' },
  decode:          { codec: 'base64' },
  encrypt:         { cipher: 'aes-gcm' },
  decrypt:         { cipher: 'aes-gcm' },
  'jwt-decode':    { jwtPart: 'payload' },
  'jwt-sign':      { jwtAlg: 'HS256', keyEncoding: 'utf8', jwtIssuedAt: true, jwtExpiresIn: '' },
  'jwt-verify':    { jwtAlg: 'HS256', keyEncoding: 'utf8' },
  'jws-sign':      { jwtAlg: 'HS256', keyEncoding: 'utf8', jwsDetached: false },
  'jws-verify':    { jwtAlg: 'HS256', keyEncoding: 'utf8' },
  'json-path':     { path: '' },
  'regex-extract': { pattern: '', regexFlags: '', group: '', matchAll: false },
  'split-pick':    { splitSep: ',', splitIndex: '0' },
  compose:         { composeParts: [], jsonSeparator: '&', jsonSort: 'none', jsonFormat: 'key=value' },
  prepend:        { text: '' },
  append:          { text: '' },
  replace:         { find: '', replacement: '', regex: false },
  'json-format':   { jsonIndent: 'pretty' },
};

const DEFAULT_STEPS: PipelineStep[] = [];

/** Settings for a transform inside a Compose part: a one-line value wants minified JSON. */
function partStepDefaults(op: StepOp): Partial<PipelineStep> {
  const { key: _key, ...defaults } = STEP_DEFAULTS[op] ?? {};
  return op === 'json-format' ? { ...defaults, jsonIndent: 'minify' } : defaults;
}

/** Delay before a run, so typing in a key box doesn't start one per keystroke. */
const RUN_DEBOUNCE_MS = 120;

export function PipelineTab({ active }: { active: boolean }) {
  const t = useMessages(MESSAGES);
  const sdk = usePluginSdkFor('base64');
  const [steps, setSteps] = usePluginState<PipelineStep[]>(sdk, 'pipeline:steps-v2', DEFAULT_STEPS, { legacyKey: 'devtool:pipeline:steps-v2' });
  // Keys, passphrases and PEM keys are credentials: kept in the vault by step
  // id, never in the plain settings file that holds the steps.
  const [stepKeys, setStepKeys, stepKeysReady] = useSecretState<Record<string, string>>(sdk, 'pipeline:step-keys', {});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  // Earlier versions stored `key` inside the steps: move it to the vault
  // once the vault has loaded, then drop it from the steps.
  useEffect(() => {
    if (!stepKeysReady) return;
    const legacy = steps.filter((s) => s.key);
    if (legacy.length === 0) return;
    setStepKeys((prev) => {
      const next = { ...prev };
      for (const s of legacy) if (!next[s.id]) next[s.id] = s.key!;
      return next;
    });
    setSteps((prev) => prev.map(({ key: _key, ...rest }) => rest));
  }, [stepKeysReady, steps, setSteps, setStepKeys]);

  const stepsWithKeys = useMemo(
    () => steps.map((s) => (SECRET_OPS.has(s.op) ? { ...s, key: stepKeys[s.id] ?? s.key ?? '' } : s)),
    [steps, stepKeys],
  );

  // Quick-paste JSON directly into the input step
  useQuickPaste((text) => {
    // Paste into the first json-input step found; if none, try first text-sunk
    setSteps((prev) => {
      const jsonIdx = prev.findIndex((s) => s.op === 'json-input');
      const textIdx = prev.findIndex((s) => s.op === 'text-sunk');
      const target = jsonIdx >= 0 ? jsonIdx : textIdx;
      if (target < 0) return prev;
      return prev.map((s, i) => {
        if (i !== target) return s;
        if (s.op === 'json-input') {
          let merged = s.jsonFields ?? [];
          if (!text.trim()) { merged = merged.filter((f) => f.type === 'custom'); }
          else { try { merged = mergeJsonFields(merged, flattenJson(JSON.parse(text))); } catch { /* keep */ } }
          return { ...s, jsonText: text, jsonFields: merged };
        }
        return { ...s, textValue: text };
      });
    });
  }, active);

  // Steps can be async (Web Crypto: AES-GCM, JWT/JWS), so results arrive
  // after render. Keyed by step id so a removed or moved step never shows
  // another step's output while the next run is in flight.
  const deferredSteps = useDeferredValue(stepsWithKeys);
  const cacheRef = useRef<StepCache | null>(null);
  const [run, setRun] = useState<{ byId: Record<string, StepResult>; last?: StepResult }>({ byId: {} });
  const [running, setRunning] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setRunning(true);
    const timer = setTimeout(() => {
      cacheRef.current ??= new StepCache();
      void executePipeline(deferredSteps, cacheRef.current).then((results) => {
        if (cancelled) return;
        const byId: Record<string, StepResult> = {};
        results.forEach((r, i) => { byId[deferredSteps[i].id] = r; });
        setRun({ byId, last: results.at(-1) });
        setRunning(false);
      });
    }, RUN_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [deferredSteps]);

  const updateStep = (id: string, { key, ...patch }: Partial<PipelineStep>) => {
    if (key !== undefined) setStepKeys((prev) => ({ ...prev, [id]: key }));
    if (Object.keys(patch).length > 0) setSteps((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));
  };

  const removeStep = (id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id));
    setStepKeys((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const moveStep = (id: string, dir: -1 | 1) => {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  const loadTemplate = (next: PipelineStep[], keys: Record<string, string>) => {
    setSteps(next);
    // The replaced steps' keys go with them; the template's own come in.
    setStepKeys(keys);
    setShowKeys({});
  };

  const addStep = (op: StepOp) => {
    const { key: _key, ...defaults } = STEP_DEFAULTS[op] ?? {};
    setSteps((prev) => [...prev, { id: makeId(), op, ...defaults }]);
  };

  return (
    <div className="tool-scrollable tool-padding tool-spacer">

      <PipelineTemplateBar steps={stepsWithKeys} onLoad={loadTemplate} makeId={makeId} />

      {/* Empty state */}
      {steps.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-fg-mute">
          <p className="text-sm font-medium">{t('noSteps')}</p>
          <p className="text-xs">{t('addNodeHint')}</p>
        </div>
      )}

      {/* Steps */}
      <div className="space-y-0">
        {stepsWithKeys.map((step, index) => (
          <div key={step.id}>
            <StepCard
              step={step} index={index} total={steps.length}
              result={run.byId[step.id]}
              input={index > 0 ? run.byId[steps[index - 1].id]?.output : undefined}
              priorSteps={steps.slice(0, index).map((s, i) => ({ id: s.id, label: `#${i + 1} ${t(`op.${s.op}`)}` }))}
              showKey={!!showKeys[step.id]}
              onToggleKey={() => setShowKeys((p) => ({ ...p, [step.id]: !p[step.id] }))}
              onUpdate={(patch) => updateStep(step.id, patch)}
              onRemove={() => removeStep(step.id)}
              onMoveUp={() => moveStep(step.id, -1)}
              onMoveDown={() => moveStep(step.id, 1)}
            />
            {index < steps.length - 1 && (
              <div className="flex justify-center py-0.5">
                <div className="w-px h-4 bg-line/50" />
              </div>
            )}
          </div>
        ))}
        <AddStepPanel onAdd={addStep} />
      </div>

      <FinalResult result={steps.length > 0 ? run.last : undefined} running={running} />
    </div>
  );
}
