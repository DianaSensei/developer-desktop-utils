/**
 * Guesses what the user wants to do with the clipboard contents.
 *
 * ⌘K reads the clipboard and, when it can tell, puts a tool first along with
 * the reason (e.g. "Looks like a JWT"), so the suggestion is explainable.
 *
 * Pure functions: reading the clipboard happens in lib/clipboard.ts. Checks
 * run from most to least specific, since valid JSON or URLs can also match
 * the looser patterns further down.
 */

import type { TranslationKey } from '@/lib/i18n';

export type ClipboardIntentKind =
  | 'jwt'
  | 'json'
  | 'uuid'
  | 'cron'
  | 'timestamp'
  | 'url'
  | 'hex'
  | 'base64';

/** `clipboard.reason.*` keys only, so reasons stay in sync with i18n.ts. */
export type ClipboardReasonKey = Extract<TranslationKey, `clipboard.reason.${string}`>;

export interface ClipboardIntent {
  kind: ClipboardIntentKind;
  /** TOOL_DEFS id of the tool to open. */
  toolId: string;
  /** Query string to open the tool with, e.g. `?tab=jwt` for a tab inside it. */
  search?: string;
  /** Translation key in lib/i18n.ts, not display text. */
  reasonKey: ClipboardReasonKey;
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/** Decodes unpadded base64url (the JWT header). */
function decodeBase64Url(segment: string): string | null {
  try {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    return atob(padded + pad);
  } catch {
    return null;
  }
}

function isJwt(text: string): boolean {
  const parts = text.split('.');
  if (parts.length !== 3) return false;
  if (!parts.every((p) => p.length > 0 && B64URL.test(p))) return false;
  // The header must decode to JSON with an "alg" key; three dot-separated
  // base64url segments alone are common outside JWTs.
  const header = decodeBase64Url(parts[0]);
  if (!header) return false;
  try {
    const parsed = JSON.parse(header);
    return typeof parsed === 'object' && parsed !== null && 'alg' in parsed;
  } catch {
    return false;
  }
}

function isJson(text: string): boolean {
  const t = text.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A 5- or 6-field cron expression of cron characters, with at least one
 * `*`, `/` or `,` (otherwise "1 2 3 4 5" would match).
 */
function isCron(text: string): boolean {
  const fields = text.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) return false;
  if (!fields.every((f) => /^[\d*/,-]+$/.test(f))) return false;
  return fields.some((f) => /[*/,]/.test(f));
}

/** 10 digits (seconds) or 13 (milliseconds), between years 2001 and 2100. */
function isTimestamp(text: string): boolean {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return false;
  if (t.length !== 10 && t.length !== 13) return false;
  const ms = t.length === 10 ? Number(t) * 1000 : Number(t);
  const year = new Date(ms).getUTCFullYear();
  return year >= 2001 && year <= 2100;
}

const URL_RE = /^https?:\/\/\S+$/i;

/** Requires a letter a–f to differ from all-digit strings (see isTimestamp). */
function isHex(text: string): boolean {
  const t = text.trim().replace(/^0x/i, '');
  if (t.length < 6 || t.length % 2 !== 0) return false;
  return /^[0-9a-f]+$/i.test(t) && /[a-f]/i.test(t);
}

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;

/** Requires `+`, `/`, `=`, or mixed case, to differ from plain hex. */
function isBase64(text: string): boolean {
  const t = text.trim();
  if (t.length < 8 || t.length % 4 !== 0) return false;
  if (!BASE64_RE.test(t)) return false;
  return /[+/=]/.test(t) || (/[A-Z]/.test(t) && /[a-z]/.test(t));
}

export function detectClipboardIntent(rawText: string | null | undefined): ClipboardIntent | null {
  if (!rawText) return null;
  const text = rawText.trim();
  if (!text || text.length > 8000) return null; // clipboard quá dài không phải thứ để đoán

  // JWT is a tab of Encode·Hash·Encrypt (it used to be its own tool).
  if (isJwt(text)) return { kind: 'jwt', toolId: 'base64', search: '?tab=jwt', reasonKey: 'clipboard.reason.jwt' };
  if (isJson(text)) return { kind: 'json', toolId: 'json', reasonKey: 'clipboard.reason.json' };
  if (UUID_RE.test(text)) return { kind: 'uuid', toolId: 'generator', reasonKey: 'clipboard.reason.uuid' };
  if (isCron(text)) return { kind: 'cron', toolId: 'cron-generator', reasonKey: 'clipboard.reason.cron' };
  if (isTimestamp(text)) return { kind: 'timestamp', toolId: 'unix-time', reasonKey: 'clipboard.reason.timestamp' };
  // A copied URL suggests QR Code: the most useful offline action for it.
  if (URL_RE.test(text)) return { kind: 'url', toolId: 'qrcode', reasonKey: 'clipboard.reason.url' };
  if (isHex(text)) return { kind: 'hex', toolId: 'base64', reasonKey: 'clipboard.reason.hex' };
  if (isBase64(text)) return { kind: 'base64', toolId: 'base64', reasonKey: 'clipboard.reason.base64' };

  return null;
}
