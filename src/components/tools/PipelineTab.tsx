import { useDeferredValue, useMemo, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus, Trash2, Copy, Eye, EyeOff, ChevronDown, ChevronUp,
  Hash, KeyRound, Code2, Type, Scissors, Search, CornerDownRight,
  AlertTriangle, CheckCircle2, ArrowRight, FileText, Braces,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useQuickPaste } from '@/hooks/useQuickPaste';
import { copyToClipboard } from '@/lib/clipboard';
import CryptoJS from 'crypto-js';

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * One row in the field table.
 * 'json'   → key from JSON object, value auto-read from parsed JSON
 * 'custom' → key + value both user-defined; can sit anywhere in the list
 */
interface FieldConfig {
  id: string;
  type: 'json' | 'custom';
  key: string;
  customValue?: string;
  enabled: boolean;
}

type StepOp =
  | 'text-input' | 'json-input' | 'hash' | 'hmac' | 'encode' | 'decode'
  | 'uppercase' | 'lowercase' | 'trim' | 'prepend' | 'append' | 'replace';

interface PipelineStep {
  id: string;
  op: StepOp;
  // Text input step
  textValue?: string;
  // JSON input step
  jsonText?: string;
  jsonFields?: FieldConfig[];
  jsonSeparator?: string;
  jsonSort?: 'none' | 'asc' | 'desc';
  jsonFormat?: 'key=value' | 'value';
  // Hash / HMAC
  algorithm?: string;
  key?: string;
  upperHex?: boolean;
  // Encode / Decode
  codec?: string;
  // Prepend / Append
  text?: string;
  // Replace
  find?: string;
  replacement?: string;
}

interface StepResult { output: string; error?: string; }

// ─── Operation metadata ────────────────────────────────────────────────────────

interface OpMeta { label: string; hint: string; icon: React.ElementType; color: string; }

const OP_META: Record<StepOp, OpMeta> = {
  'text-input': { label: 'Text Input',    hint: 'Free text — type or paste any string',                 icon: FileText,        color: 'text-emerald-500' },
  'json-input': { label: 'JSON Input',    hint: 'Parse JSON and assemble fields into a string',         icon: Braces,          color: 'text-emerald-500' },
  hmac:         { label: 'HMAC Sign',     hint: 'Keyed signature — MoMo, ZaloPay, Alipay, REST APIs',  icon: KeyRound,        color: 'text-violet-500'  },
  hash:         { label: 'Hash',          hint: 'One-way fingerprint — MD5, SHA-256, SHA-512, …',       icon: Hash,            color: 'text-blue-500'    },
  encode:       { label: 'Encode',        hint: 'Base64, URL-encode, Hex, …',                           icon: Code2,           color: 'text-cyan-500'    },
  decode:       { label: 'Decode',        hint: 'Reverse Base64, URL-encode, Hex, …',                   icon: Code2,           color: 'text-cyan-500'    },
  uppercase:    { label: 'Uppercase',     hint: 'UPPER CASE every letter',                              icon: Type,            color: 'text-slate-400'   },
  lowercase:    { label: 'Lowercase',     hint: 'lower case every letter',                              icon: Type,            color: 'text-slate-400'   },
  trim:         { label: 'Trim spaces',   hint: 'Remove leading / trailing whitespace',                 icon: Scissors,        color: 'text-slate-400'   },
  prepend:      { label: 'Prepend text',  hint: 'Add fixed text before the current value',              icon: CornerDownRight, color: 'text-amber-500'   },
  append:       { label: 'Append text',   hint: 'Add fixed text after the current value',               icon: CornerDownRight, color: 'text-amber-500'   },
  replace:      { label: 'Find & Replace',hint: 'Replace every occurrence of a string',                 icon: Search,          color: 'text-amber-500'   },
};

const OP_GROUPS: { label: string; ops: StepOp[] }[] = [
  { label: 'Input',       ops: ['text-input', 'json-input'] },
  { label: 'Sign / Hash', ops: ['hmac', 'hash'] },
  { label: 'Encode',      ops: ['encode', 'decode'] },
  { label: 'Text',        ops: ['uppercase', 'lowercase', 'trim', 'prepend', 'append', 'replace'] },
];

const HASH_ALGOS = [
  { id: 'md5',       label: 'MD5',        bits: 128 },
  { id: 'sha1',      label: 'SHA-1',      bits: 160 },
  { id: 'sha256',    label: 'SHA-256',    bits: 256 },
  { id: 'sha384',    label: 'SHA-384',    bits: 384 },
  { id: 'sha512',    label: 'SHA-512',    bits: 512 },
  { id: 'ripemd160', label: 'RIPEMD-160', bits: 160 },
] as const;
type HashAlgo = (typeof HASH_ALGOS)[number]['id'];

const CODECS = [
  { id: 'base64',    label: 'Base64'     },
  { id: 'base64url', label: 'Base64 URL' },
  { id: 'url',       label: 'URL Encode' },
  { id: 'hex',       label: 'Hex'        },
  { id: 'binary',    label: 'Binary'     },
] as const;
type CodecId = (typeof CODECS)[number]['id'];

const SEP_OPTIONS = [
  { id: '&',  label: '& — query string' },
  { id: '|',  label: '| — pipe'         },
  { id: '\n', label: '↵ — newline'       },
  { id: ',',  label: ', — comma'         },
];

// ─── Crypto helpers ────────────────────────────────────────────────────────────

function computeHash(algo: HashAlgo, input: string): string {
  switch (algo) {
    case 'md5':       return CryptoJS.MD5(input).toString();
    case 'sha1':      return CryptoJS.SHA1(input).toString();
    case 'sha256':    return CryptoJS.SHA256(input).toString();
    case 'sha384':    return CryptoJS.SHA384(input).toString();
    case 'sha512':    return CryptoJS.SHA512(input).toString();
    case 'ripemd160': return CryptoJS.RIPEMD160(input).toString();
  }
}
function computeHmac(algo: HashAlgo, input: string, key: string): string {
  switch (algo) {
    case 'md5':       return CryptoJS.HmacMD5(input, key).toString();
    case 'sha1':      return CryptoJS.HmacSHA1(input, key).toString();
    case 'sha256':    return CryptoJS.HmacSHA256(input, key).toString();
    case 'sha384':    return CryptoJS.HmacSHA384(input, key).toString();
    case 'sha512':    return CryptoJS.HmacSHA512(input, key).toString();
    case 'ripemd160': return CryptoJS.HmacRIPEMD160(input, key).toString();
  }
}

const enc = new TextEncoder(), dec = new TextDecoder();
const toBytes = (s: string) => enc.encode(s);
const fromBytes = (b: Uint8Array) => dec.decode(b);

function codecEncode(id: CodecId, input: string): string {
  switch (id) {
    case 'base64': {
      let bin = ''; toBytes(input).forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin);
    }
    case 'base64url': {
      let bin = ''; toBytes(input).forEach((b) => { bin += String.fromCharCode(b); });
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    case 'url':    return encodeURIComponent(input);
    case 'hex':    return Array.from(toBytes(input)).map((b) => b.toString(16).padStart(2, '0')).join('');
    case 'binary': return Array.from(toBytes(input)).map((b) => b.toString(2).padStart(8, '0')).join(' ');
  }
}
function codecDecode(id: CodecId, input: string): string {
  switch (id) {
    case 'base64': {
      const bin = atob(input.replace(/\s+/g, ''));
      return fromBytes(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    }
    case 'base64url': {
      const s = input.replace(/-/g, '+').replace(/_/g, '/');
      const padded = s + '='.repeat((4 - s.length % 4) % 4);
      return fromBytes(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
    }
    case 'url':    return decodeURIComponent(input);
    case 'hex': {
      const tokens = input.replace(/\s+/g, '').match(/.{1,2}/g) ?? [];
      return fromBytes(Uint8Array.from(tokens.map((t) => parseInt(t, 16))));
    }
    case 'binary':
      return fromBytes(Uint8Array.from(input.trim().split(/\s+/).map((t) => parseInt(t, 2))));
  }
}

// ─── JSON flattening ───────────────────────────────────────────────────────────

/**
 * Recursively flatten any JSON value into a flat string map.
 * Objects use dot notation (user.name), arrays use bracket notation (items[0]).
 */
function flattenJson(value: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (value === null || value === undefined) {
    if (prefix) out[prefix] = '';
  } else if (typeof value !== 'object') {
    if (prefix) out[prefix] = String(value);
  } else if (Array.isArray(value)) {
    if (value.length === 0 && prefix) { out[prefix] = '[]'; }
    else value.forEach((item, i) => Object.assign(out, flattenJson(item, prefix ? `${prefix}[${i}]` : `[${i}]`)));
  } else {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0 && prefix) { out[prefix] = '{}'; }
    else keys.forEach((k) => Object.assign(out, flattenJson(obj[k], prefix ? `${prefix}.${k}` : k)));
  }
  return out;
}

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

// ─── Step execution ────────────────────────────────────────────────────────────

function executeStep(step: PipelineStep, input: string): StepResult {
  try {
    switch (step.op) {
      case 'text-input':
        return { output: step.textValue ?? '' };
      case 'json-input': {
        let flatMap: Record<string, string> = {};
        try { flatMap = flattenJson(JSON.parse(step.jsonText ?? '')); } catch { /* empty */ }
        let active = (step.jsonFields ?? []).filter((f) => f.enabled);
        const sort = step.jsonSort ?? 'none';
        if (sort === 'asc')  active = [...active].sort((a, b) => a.key.localeCompare(b.key));
        if (sort === 'desc') active = [...active].sort((a, b) => b.key.localeCompare(a.key));
        const sep = step.jsonSeparator ?? '&';
        const fmt = step.jsonFormat ?? 'key=value';
        const parts = active.map((f) => {
          const val = f.type === 'custom' ? (f.customValue ?? '') : (flatMap[f.key] ?? '');
          return fmt === 'key=value' ? `${f.key}=${val}` : val;
        });
        return { output: parts.join(sep) };
      }
      case 'hash': {
        if (!input) return { output: '' };
        const r = computeHash((step.algorithm ?? 'sha256') as HashAlgo, input);
        return { output: step.upperHex ? r.toUpperCase() : r };
      }
      case 'hmac': {
        if (!input) return { output: '' };
        if (!step.key) return { output: '', error: 'Secret key required' };
        const r = computeHmac((step.algorithm ?? 'sha256') as HashAlgo, input, step.key);
        return { output: step.upperHex ? r.toUpperCase() : r };
      }
      case 'encode': return { output: codecEncode((step.codec ?? 'base64') as CodecId, input) };
      case 'decode': return { output: codecDecode((step.codec ?? 'base64') as CodecId, input) };
      case 'uppercase': return { output: input.toUpperCase() };
      case 'lowercase': return { output: input.toLowerCase() };
      case 'trim':      return { output: input.trim() };
      case 'prepend':   return { output: (step.text ?? '') + input };
      case 'append':    return { output: input + (step.text ?? '') };
      case 'replace':   return { output: input.split(step.find ?? '').join(step.replacement ?? '') };
      default:          return { output: input };
    }
  } catch (err) {
    return { output: '', error: err instanceof Error ? err.message : 'Step failed' };
  }
}

function executePipeline(steps: PipelineStep[]): StepResult[] {
  const results: StepResult[] = [];
  let current = '';
  for (const step of steps) {
    const res = executeStep(step, current);
    results.push(res);
    if (res.error) break;
    current = res.output;
  }
  return results;
}

// ─── ID helper ─────────────────────────────────────────────────────────────────

function makeId() { return Math.random().toString(36).slice(2, 9); }

// ─── Shared tiny components ────────────────────────────────────────────────────

function HexToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button" onClick={() => onChange(!value)}
      className={cn(
        'text-[11px] font-mono px-2 h-7 rounded-md border transition-colors',
        value ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground'
      )}
    >
      {value ? 'ABC' : 'abc'}
    </button>
  );
}

function CopyBtn({ value, mini = false }: { value: string; mini?: boolean }) {
  const [done, setDone] = useState(false);
  const go = () => { copyToClipboard(value); setDone(true); setTimeout(() => setDone(false), 1400); };
  return (
    <button
      type="button" disabled={!value} onClick={go}
      className={cn(
        'flex items-center gap-1 rounded-md font-medium transition-colors disabled:opacity-30',
        mini
          ? 'text-[10px] px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/60'
          : 'text-xs px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/60'
      )}
    >
      {done
        ? <><CheckCircle2 className="h-3 w-3 text-green-500" />{!mini && 'Copied'}</>
        : <><Copy className="h-3 w-3" />{!mini && 'Copy'}</>
      }
    </button>
  );
}

function OutputText({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 160;
  const long = value.length > LIMIT;
  return (
    <span className="break-all">
      {long && !expanded ? value.slice(0, LIMIT) : value}
      {long && (
        <button type="button" onClick={() => setExpanded((v) => !v)}
          className="ml-1 text-primary text-[10px] font-sans underline underline-offset-2">
          {expanded ? 'less' : `+${value.length - LIMIT} more`}
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
          field.enabled ? 'bg-primary border-primary' : 'border-border bg-card'
        )}
      >
        {field.enabled && <span className="text-[8px] font-black text-primary-foreground leading-none">✓</span>}
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
            placeholder="key"
            className="h-7 text-xs font-mono"
          />
        ) : (
          <div className={cn('flex items-center gap-1.5 min-w-0', !field.enabled && 'opacity-40')}>
            <span className="text-xs font-mono font-medium text-foreground truncate">{field.key}</span>
            {missing && (
              <span className="shrink-0 text-[9px] font-medium text-amber-500 bg-amber-50 dark:bg-amber-950/30 border border-amber-300/50 dark:border-amber-700/40 px-1 py-px rounded leading-none">
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
            placeholder="value"
            className="h-7 text-xs font-mono"
          />
        ) : (
          <span className={cn(
            'block text-xs font-mono truncate',
            field.enabled ? 'text-muted-foreground' : 'text-muted-foreground/30',
            missing && 'text-muted-foreground/30 italic'
          )}>
            {jsonVal != null ? jsonVal : '—'}
          </span>
        )}
      </div>

      {/* Move / delete — visible on row hover */}
      <div className="shrink-0 flex items-center gap-px opacity-0 group-hover/row:opacity-100 transition-opacity">
        <button type="button" disabled={isFirst} onClick={() => onMove(-1)}
          className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors">
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button type="button" disabled={isLast} onClick={() => onMove(1)}
          className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors">
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {field.type === 'custom' && (
          <button type="button" onClick={onRemove}
            className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors">
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
  // Flat map for the field-value preview column
  const flatMap = useMemo<Record<string, string> | null>(() => {
    if (!jsonText.trim()) return null;
    try { return flattenJson(JSON.parse(jsonText)); }
    catch { return null; }
  }, [jsonText]);

  const jsonError = useMemo(() => {
    if (!jsonText.trim()) return null;
    try { JSON.parse(jsonText); return null; }
    catch (e) { return e instanceof Error ? e.message : 'Invalid JSON'; }
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
      {/* ── JSON textarea ── */}
      <div className="relative">
        <Textarea
          value={jsonText}
          onChange={(e) => handleJsonChange(e.target.value)}
          placeholder={'Paste JSON here\n\n{ "amount": "50000", "orderId": "abc", ... }'}
          className={cn(
            'min-h-[110px] font-mono text-xs resize-y leading-relaxed',
            jsonError && jsonText.trim() && 'border-amber-400/60'
          )}
          spellCheck={false}
        />
        {/* Validity badge */}
        {jsonText.trim() && (
          <div className="absolute top-2 right-2 pointer-events-none">
            {jsonError
              ? <span className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 dark:bg-amber-950/40 border border-amber-300/60 px-1.5 py-0.5 rounded">
                  <AlertTriangle className="h-2.5 w-2.5" />Invalid
                </span>
              : <span className="flex items-center gap-1 text-[10px] text-green-600 bg-green-50 dark:bg-green-950/40 border border-green-300/60 px-1.5 py-0.5 rounded">
                  <CheckCircle2 className="h-2.5 w-2.5" />Valid
                </span>
            }
          </div>
        )}
      </div>

      {/* ── Output options ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground font-medium">Sep</span>
          <Select value={jsonSeparator} onValueChange={(v) => onUpdate({ jsonSeparator: v })}>
            <SelectTrigger className="h-7 w-36 text-xs rounded-lg"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SEP_OPTIONS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground font-medium">Format</span>
          <Segmented
            value={jsonFormat}
            onValueChange={(v) => onUpdate({ jsonFormat: v })}
            size="sm"
            options={[
              { value: 'key=value', label: 'key=value' },
              { value: 'value', label: 'value only' },
            ]}
            aria-label="JSON format"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground font-medium">Sort</span>
          <Segmented
            value={jsonSort}
            onValueChange={(v) => onUpdate({ jsonSort: v })}
            size="sm"
            options={[
              { value: 'none', label: 'None' },
              { value: 'asc', label: 'A→Z' },
              { value: 'desc', label: 'Z→A' },
            ]}
            aria-label="JSON sort"
          />
        </div>
      </div>

      {/* ── Unified field table ── */}
      {jsonFields.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border-b border-border">
            <div className="w-4" />
            <span className="w-36 shrink-0 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Field</span>
            <span className="flex-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Value</span>
          </div>
          {/* Rows */}
          <div className="px-3 divide-y divide-border/30">
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
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Add custom field
      </button>
    </div>
  );
}

// ─── Step output bar ───────────────────────────────────────────────────────────

function StepOutputBar({ result }: { result: StepResult | undefined }) {
  if (!result) return null;
  return (
    <div className={cn(
      'flex items-start gap-2 px-3 py-2 border-t text-xs font-mono',
      result.error
        ? 'bg-destructive/5 border-destructive/20 text-destructive'
        : 'bg-muted/20 border-border/40 text-muted-foreground'
    )}>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 mt-px text-muted-foreground/50" />
      <span className="flex-1 min-w-0">
        {result.error
          ? <span className="flex items-center gap-1.5"><AlertTriangle className="h-3 w-3 shrink-0" />{result.error}</span>
          : result.output
            ? <OutputText value={result.output} />
            : <span className="opacity-30 italic">—</span>
        }
      </span>
      {!result.error && result.output && <CopyBtn value={result.output} mini />}
    </div>
  );
}

// ─── Step card ─────────────────────────────────────────────────────────────────

interface StepCardProps {
  step: PipelineStep;
  index: number;
  total: number;
  result: StepResult | undefined;
  showKey: boolean;
  onToggleKey: () => void;
  onUpdate: (patch: Partial<PipelineStep>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function StepCard({ step, index, total, result, showKey, onToggleKey, onUpdate, onRemove, onMoveUp, onMoveDown }: StepCardProps) {
  const meta = OP_META[step.op];

  return (
    <div className={cn(
      'rounded-xl border bg-card shadow-sm overflow-hidden',
      result?.error ? 'border-destructive/30' : 'border-border'
    )}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border/40">
        <div className={cn(
          'shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold',
          result?.error ? 'bg-destructive/20 text-destructive' : 'bg-primary/15 text-primary'
        )}>
          {index + 1}
        </div>

        <Select value={step.op} onValueChange={(v) => onUpdate({ op: v as StepOp })}>
          <SelectTrigger className="h-7 flex-1 max-w-[180px] text-xs font-semibold border-0 bg-transparent shadow-none focus:ring-0 px-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OP_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="px-2 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{group.label}</div>
                {group.ops.map((op) => {
                  const m = OP_META[op];
                  return (
                    <SelectItem key={op} value={op}>
                      <span className="flex items-center gap-2">
                        <m.icon className={cn('h-3 w-3', m.color)} />{m.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </div>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-0.5 ml-auto">
          <button type="button" disabled={index === 0} onClick={onMoveUp} className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors">
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" disabled={index === total - 1} onClick={onMoveDown} className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onRemove} className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Params */}
      <div className="px-3 pt-3 pb-3 space-y-2.5">
        {/* Text input step */}
        {step.op === 'text-input' && (
          <Textarea
            value={step.textValue ?? ''}
            onChange={(e) => onUpdate({ textValue: e.target.value })}
            placeholder="Type or paste any text…"
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

        {/* Hash */}
        {step.op === 'hash' && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={step.algorithm ?? 'sha256'} onValueChange={(v) => onUpdate({ algorithm: v })}>
              <SelectTrigger className="h-7 w-36 text-xs rounded-lg"><SelectValue /></SelectTrigger>
              <SelectContent>
                {HASH_ALGOS.map((a) => <SelectItem key={a.id} value={a.id}>{a.label} ({a.bits}-bit)</SelectItem>)}
              </SelectContent>
            </Select>
            <HexToggle value={!!step.upperHex} onChange={(v) => onUpdate({ upperHex: v })} />
          </div>
        )}

        {/* HMAC */}
        {step.op === 'hmac' && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={step.algorithm ?? 'sha256'} onValueChange={(v) => onUpdate({ algorithm: v })}>
                <SelectTrigger className="h-7 w-36 text-xs rounded-lg"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HASH_ALGOS.map((a) => <SelectItem key={a.id} value={a.id}>{a.label} ({a.bits}-bit)</SelectItem>)}
                </SelectContent>
              </Select>
              <HexToggle value={!!step.upperHex} onChange={(v) => onUpdate({ upperHex: v })} />
            </div>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={step.key ?? ''}
                onChange={(e) => onUpdate({ key: e.target.value })}
                placeholder="Secret key…"
                className="h-8 pr-9 font-mono text-sm"
              />
              <button type="button" onClick={onToggleKey} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

        {/* Encode / Decode */}
        {(step.op === 'encode' || step.op === 'decode') && (
          <Select value={step.codec ?? 'base64'} onValueChange={(v) => onUpdate({ codec: v })}>
            <SelectTrigger className="h-7 w-44 text-xs rounded-lg"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CODECS.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {/* Prepend / Append */}
        {(step.op === 'prepend' || step.op === 'append') && (
          <div className="flex items-center gap-2">
            <code className="text-[10px] text-muted-foreground bg-muted/40 border border-border/60 rounded px-1.5 py-0.5 shrink-0 whitespace-nowrap">
              {step.op === 'prepend' ? '[text] + value' : 'value + [text]'}
            </code>
            <Input
              value={step.text ?? ''}
              onChange={(e) => onUpdate({ text: e.target.value })}
              placeholder={step.op === 'prepend' ? 'Text to prepend…' : 'Text to append…'}
              className="h-7 text-xs font-mono flex-1"
            />
          </div>
        )}

        {/* Replace */}
        {step.op === 'replace' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Find (all occurrences)</p>
              <Input value={step.find ?? ''} onChange={(e) => onUpdate({ find: e.target.value })} placeholder="Find…" className="h-7 text-xs font-mono" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Replace with (empty = delete)</p>
              <Input value={step.replacement ?? ''} onChange={(e) => onUpdate({ replacement: e.target.value })} placeholder="Replace with…" className="h-7 text-xs font-mono" />
            </div>
          </div>
        )}

        {/* No-param ops */}
        {(step.op === 'uppercase' || step.op === 'lowercase' || step.op === 'trim') && (
          <p className="text-xs text-muted-foreground">{meta.hint}</p>
        )}
      </div>

      <StepOutputBar result={result} />
    </div>
  );
}

// ─── Add step panel ────────────────────────────────────────────────────────────

function AddStepPanel({ onAdd }: { onAdd: (op: StepOp) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="w-px h-3 bg-border/50" />
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}
          className="h-7 px-4 text-xs rounded-full border-dashed gap-1.5 text-muted-foreground hover:text-foreground">
          <Plus className="h-3 w-3" />Add step
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-px h-3 bg-border/50" />
      <div className="w-full rounded-xl border border-dashed border-primary/30 bg-primary/3 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">Add a step</p>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
        </div>
        {OP_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{group.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.ops.map((op) => {
                const m = OP_META[op]; const Icon = m.icon;
                return (
                  <button key={op} type="button"
                    onClick={() => { onAdd(op); setOpen(false); }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-card text-xs font-medium hover:border-primary/40 hover:bg-primary/5 hover:text-primary transition-all">
                    <Icon className={cn('h-3.5 w-3.5', m.color)} />{m.label}
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

function FinalResult({ result }: { result: StepResult | undefined }) {
  if (!result || (!result.output && !result.error)) return null;
  const ok = !!result.output && !result.error;
  return (
    <div className={cn('rounded-xl border p-4', ok ? 'border-primary/25 bg-primary/5' : 'border-destructive/25 bg-destructive/5')}>
      <div className="flex items-center justify-between mb-2.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          {ok ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-destructive" />}
          {ok ? 'Final Result' : 'Pipeline Error'}
        </span>
        {ok && <CopyBtn value={result.output} />}
      </div>
      {ok
        ? <p className="font-mono text-sm leading-relaxed break-all text-foreground">{result.output}</p>
        : <p className="text-sm text-destructive">{result.error}</p>
      }
      {ok && <p className="text-[10px] text-muted-foreground/40 mt-1.5">{result.output.length} chars</p>}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

const STEP_DEFAULTS: Partial<Record<StepOp, Partial<PipelineStep>>> = {
  'text-input': { textValue: '' },
  'json-input': { jsonText: '', jsonFields: [], jsonSeparator: '&', jsonSort: 'none', jsonFormat: 'key=value' },
  hmac:         { algorithm: 'sha256', key: '', upperHex: false },
  hash:         { algorithm: 'sha256', upperHex: false },
  encode:       { codec: 'base64' },
  decode:       { codec: 'base64' },
  prepend:      { text: '' },
  append:       { text: '' },
  replace:      { find: '', replacement: '' },
};

const DEFAULT_STEPS: PipelineStep[] = [];

export function PipelineTab({ active }: { active: boolean }) {
  const [steps, setSteps] = usePersistentState<PipelineStep[]>('devtool:pipeline:steps-v2', DEFAULT_STEPS);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  // Quick-paste JSON directly into the input step
  useQuickPaste((text) => {
    // Paste into the first json-input step found; if none, try first text-input
    setSteps((prev) => {
      const jsonIdx = prev.findIndex((s) => s.op === 'json-input');
      const textIdx = prev.findIndex((s) => s.op === 'text-input');
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

  const deferredSteps = useDeferredValue(steps);
  const results = useMemo(() => executePipeline(deferredSteps), [deferredSteps]);

  const updateStep = (id: string, patch: Partial<PipelineStep>) =>
    setSteps((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));

  const removeStep = (id: string) =>
    setSteps((prev) => prev.filter((s) => s.id !== id));

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

  const addStep = (op: StepOp) => {
    setSteps((prev) => [...prev, { id: makeId(), op, ...(STEP_DEFAULTS[op] ?? {}) }]);
  };

  return (
    <div className="tool-scrollable tool-padding tool-spacer">

      {/* Empty state */}
      {steps.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <p className="text-sm font-medium">No steps yet</p>
          <p className="text-xs">Add a node below to start building your pipeline.</p>
        </div>
      )}

      {/* Steps */}
      <div className="space-y-0">
        {steps.map((step, index) => (
          <div key={step.id}>
            <StepCard
              step={step} index={index} total={steps.length}
              result={results[index]}
              showKey={!!showKeys[step.id]}
              onToggleKey={() => setShowKeys((p) => ({ ...p, [step.id]: !p[step.id] }))}
              onUpdate={(patch) => updateStep(step.id, patch)}
              onRemove={() => removeStep(step.id)}
              onMoveUp={() => moveStep(step.id, -1)}
              onMoveDown={() => moveStep(step.id, 1)}
            />
            {index < steps.length - 1 && (
              <div className="flex justify-center py-0.5">
                <div className="w-px h-4 bg-border/50" />
              </div>
            )}
          </div>
        ))}
        <AddStepPanel onAdd={addStep} />
      </div>

      <FinalResult result={results.at(-1)} />
    </div>
  );
}
