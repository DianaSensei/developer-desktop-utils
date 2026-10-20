// Saved pipelines ("templates") — pure helpers, no React.
//
// A template is a list of steps with their settings. Keys are never part of
// it: steps are saved in the plain settings file, so a template that should
// remember its keys keeps them in the vault, under the template id (see
// PipelineTemplates.tsx).

import type { PipelineStep } from './pipelineEngine';

export interface PipelineTemplate {
  id: string;
  name: string;
  steps: PipelineStep[];
  updatedAt: number;
}

/** Built-in examples. Ids start with `builtin:`, they cannot be deleted or overwritten. */
export interface BuiltinTemplate extends PipelineTemplate {
  /** Message key of the name / description, translated by the UI. */
  nameKey: 'tpl.appleAdvancedCommerce' | 'tpl.appleNotification' | 'tpl.paymentHmac';
  descKey: 'tpl.appleAdvancedCommerceDesc' | 'tpl.appleNotificationDesc' | 'tpl.paymentHmacDesc';
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'builtin:apple-advanced-commerce',
    name: 'Apple Advanced Commerce JWS → request',
    nameKey: 'tpl.appleAdvancedCommerce',
    descKey: 'tpl.appleAdvancedCommerceDesc',
    updatedAt: 0,
    steps: [
      { id: 'a1', op: 'text-sunk', textValue: '' },
      { id: 'a2', op: 'jws-verify', jwtAlg: 'ES256', keySource: 'x5c' },
      { id: 'a3', op: 'json-path', path: 'request' },
      { id: 'a4', op: 'decode', codec: 'base64' },
      { id: 'a5', op: 'json-format', jsonIndent: 'pretty' },
    ],
  },
  {
    id: 'builtin:apple-notification',
    name: 'App Store Server Notification → transaction',
    nameKey: 'tpl.appleNotification',
    descKey: 'tpl.appleNotificationDesc',
    updatedAt: 0,
    steps: [
      { id: 'n1', op: 'text-sunk', textValue: '' },
      { id: 'n2', op: 'json-path', path: 'signedPayload' },
      { id: 'n3', op: 'jws-verify', jwtAlg: 'ES256', keySource: 'x5c' },
      { id: 'n4', op: 'json-path', path: 'data.signedTransactionInfo' },
      { id: 'n5', op: 'jws-verify', jwtAlg: 'ES256', keySource: 'x5c' },
      { id: 'n6', op: 'json-format', jsonIndent: 'pretty' },
    ],
  },
  {
    id: 'builtin:payment-hmac',
    name: 'Payment signature (sorted fields → HMAC-SHA256)',
    nameKey: 'tpl.paymentHmac',
    descKey: 'tpl.paymentHmacDesc',
    updatedAt: 0,
    steps: [
      { id: 'p1', op: 'json-input', jsonText: '', jsonFields: [], jsonSeparator: '&', jsonSort: 'asc', jsonFormat: 'key=value' },
      { id: 'p2', op: 'hmac', algorithm: 'sha256', digest: 'hex', keyEncoding: 'utf8', upperHex: false },
    ],
  },
];

export const isBuiltin = (id: string) => id.startsWith('builtin:');

export interface SaveOptions {
  /** Keep what was typed into input steps (text, JSON, detached payload). */
  keepInput: boolean;
}

/** Steps as a template stores them: no keys, and no input data unless asked. */
export function toTemplateSteps(steps: PipelineStep[], { keepInput }: SaveOptions): PipelineStep[] {
  return steps.map(({ key: _key, ...s }) => {
    if (keepInput) return s;
    const out: PipelineStep = { ...s };
    if (out.op === 'text-sunk') out.textValue = '';
    if (out.op === 'json-input') {
      out.jsonText = '';
      // Rows read from the JSON go with it; custom rows are configuration.
      out.jsonFields = (out.jsonFields ?? []).filter((f) => f.type === 'custom');
    }
    if (out.detachedPayload !== undefined) out.detachedPayload = '';
    return out;
  });
}

/**
 * Fresh steps for the pipeline from a template. New ids, so the loaded
 * steps never pick up keys the vault holds for other steps; `idMap` maps
 * the template's step ids to them, for restoring the template's own keys.
 */
export function instantiateTemplate(
  template: PipelineTemplate,
  makeId: () => string,
): { steps: PipelineStep[]; idMap: Record<string, string> } {
  const idMap: Record<string, string> = {};
  const steps = template.steps.map((s) => {
    const id = makeId();
    idMap[s.id] = id;
    return {
      ...s,
      id,
      jsonFields: s.jsonFields?.map((f) => ({ ...f, id: makeId() })),
    };
  });
  return { steps, idMap };
}

/** Insert or replace by id, newest first. */
export function upsertTemplate(list: PipelineTemplate[], template: PipelineTemplate): PipelineTemplate[] {
  return [template, ...list.filter((t) => t.id !== template.id)];
}

/** Accepts what `exportTemplates` produced: one template or a list. Throws on anything else. */
export function parseTemplates(text: string): PipelineTemplate[] {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Not valid JSON.'); }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((t, i) => {
    const o = t as Partial<PipelineTemplate>;
    if (!o || typeof o.name !== 'string' || !o.name.trim() || !Array.isArray(o.steps)
      || !o.steps.every((s) => s && typeof s === 'object' && typeof (s as PipelineStep).op === 'string')) {
      throw new Error(`Template #${i + 1} is not a pipeline template (needs "name" and "steps").`);
    }
    return {
      id: typeof o.id === 'string' && !isBuiltin(o.id) ? o.id : '',
      name: o.name.trim(),
      // A shared file must not be able to smuggle a key into the plain settings.
      steps: (o.steps as PipelineStep[]).map(({ key: _key, ...s }, j) => ({ ...s, id: typeof s.id === 'string' ? s.id : `s${j}` })),
      updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now(),
    };
  });
}

/** Templates as shareable JSON — never with keys (they are not in the steps). */
export function exportTemplates(list: PipelineTemplate[]): string {
  return JSON.stringify(list.map(({ id, name, steps, updatedAt }) => ({ id, name, steps, updatedAt })), null, 2);
}
