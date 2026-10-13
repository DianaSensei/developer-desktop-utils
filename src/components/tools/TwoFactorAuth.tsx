import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TextEditor } from '@/design-system';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchInput } from '@/components/ui/search-input';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  ShieldCheck, Check, Plus, Trash2, Eye, EyeOff,
  RefreshCw, ChevronDown, ChevronUp, ArrowRight,
  Upload, Download, QrCode, FileText, ClipboardPaste,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { saveTextFile } from '@/lib/fileio';
import { usePluginSdk, useSecretState } from '@/platform';
import { base32Decode, parseOtpImport, type ParsedOtp } from '@/lib/otpauth';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from '@/components/tools/TwoFactorAuth.messages';

// ─── Types ────────────────────────────────────────────────────────────────────

type Algorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';
type OTPType = 'totp' | 'hotp';

interface Account {
  id: string;
  name: string;
  issuer: string;
  secret: string;
  algorithm: Algorithm;
  digits: number;
  period: number;
  type: OTPType;
  counter: number;
}

// ─── Avatar helpers ───────────────────────────────────────────────────────────

// Avatar color from a hash of the name: stable per account and 360 hues
// instead of 12 classes. An identity color (like GitHub avatars), with
// fixed saturation/lightness so white text stays readable.
function avatarStyle(name: string): { backgroundColor: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return { backgroundColor: `hsl(${Math.abs(h) % 360} 52% 42%)` };
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (!words[0]) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// ─── HOTP / TOTP ─────────────────────────────────────────────────────────────

async function computeHOTP(secret: Uint8Array, counter: number, digits: number, alg: Algorithm): Promise<string> {
  // Use a narrowed type to avoid DOM overload complexity
  type SubtleHmac = {
    importKey(f: 'raw', d: Uint8Array, a: { name: string; hash: { name: string } }, x: false, u: ['sign']): Promise<CryptoKey>;
    sign(a: string, k: CryptoKey, d: Uint8Array): Promise<ArrayBuffer>;
  };
  const subtle = crypto.subtle as unknown as SubtleHmac;
  const key = await subtle.importKey('raw', secret, { name: 'HMAC', hash: { name: alg } }, false, ['sign']);
  const cb = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { cb[i] = c & 0xff; c = Math.floor(c / 256); }
  const sig = new Uint8Array(await subtle.sign('HMAC', key, cb));
  const off = sig[sig.length - 1] & 0x0f;
  const code = (((sig[off] & 0x7f) << 24) | ((sig[off + 1] & 0xff) << 16) | ((sig[off + 2] & 0xff) << 8) | (sig[off + 3] & 0xff));
  return String(code % Math.pow(10, digits)).padStart(digits, '0');
}

async function computeTOTP(secret: Uint8Array, period: number, digits: number, alg: Algorithm): Promise<string> {
  return computeHOTP(secret, Math.floor(Date.now() / 1000 / period), digits, alg);
}

function timeRemaining(period: number): number {
  return period - (Math.floor(Date.now() / 1000) % period);
}

/** Index of the current TOTP window (the counter `computeTOTP` uses). A
 *  change means the code expired, which is a reliable refresh signal. */
function totpWindow(period: number): number {
  return Math.floor(Date.now() / 1000 / period);
}

// ─── Circular countdown ring ──────────────────────────────────────────────────

function CountdownRing({ remaining, period }: { remaining: number; period: number }) {
  const r = 17;
  const circ = 2 * Math.PI * r;
  const pct = remaining / period;
  const offset = circ * (1 - pct);
  const stroke = remaining <= 5 ? '#ef4444' : remaining <= 10 ? '#f59e0b' : '#10b981';

  return (
    <div className="relative flex items-center justify-center w-11 h-11 shrink-0">
      <svg width="44" height="44" className="-rotate-90" style={{ overflow: 'visible' }}>
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="2.5" className="stroke-bg-2" />
        <circle
          cx="22" cy="22" r={r} fill="none" strokeWidth="2.5"
          stroke={stroke} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.4s ease' }}
        />
      </svg>
      <span
        className="absolute text-[11px] font-mono font-bold tabular-nums"
        style={{ color: stroke, transition: 'color 0.4s ease' }}
      >
        {remaining}
      </span>
    </div>
  );
}

// ─── OTP code display ─────────────────────────────────────────────────────────

function CodeDisplay({ code, digits }: { code: string; digits: number }) {
  const half = Math.ceil(digits / 2);
  const left = code.slice(0, half);
  const right = code.slice(half);
  const isEmpty = !code || code === '------' || code === '--------';

  return (
    <div className="flex items-center gap-2 select-all">
      <span className={cn(
        'font-mono font-bold tabular-nums tracking-[0.2em] transition-opacity duration-300',
        'text-[1.75rem] leading-none',
        isEmpty ? 'opacity-30' : 'opacity-100',
      )}>
        {isEmpty ? '•'.repeat(half) : left}
      </span>
      <span className="text-fg-mute/40 text-lg font-light select-none">·</span>
      <span className={cn(
        'font-mono font-bold tabular-nums tracking-[0.2em] transition-opacity duration-300',
        'text-[1.75rem] leading-none',
        isEmpty ? 'opacity-30' : 'opacity-100',
      )}>
        {isEmpty ? '•'.repeat(digits - half) : right}
      </span>
    </div>
  );
}

// ─── OTP Card ─────────────────────────────────────────────────────────────────

interface OTPCardProps {
  account: Account;
  onDelete: (id: string) => void;
  onCounterIncrement: (id: string) => void;
}

function OTPCard({ account, onDelete, onCounterIncrement }: OTPCardProps) {
  const m = useMessages(MESSAGES);
  const [code, setCode] = useState('');
  const [remaining, setRemaining] = useState(account.period);
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const generate = useCallback(async () => {
    if (!account.secret.trim()) { setCode(''); setError(''); return; }
    try {
      const bytes = base32Decode(account.secret);
      const result = account.type === 'hotp'
        ? await computeHOTP(bytes, account.counter, account.digits, account.algorithm)
        : await computeTOTP(bytes, account.period, account.digits, account.algorithm);
      setCode(result);
      setError('');
    } catch (e) {
      setCode('');
      setError(e instanceof Error ? e.message : m('invalidSecret'));
    }
  }, [account]);

  useEffect(() => {
    generate();
    if (account.type === 'totp') {
      setRemaining(timeRemaining(account.period));
      // Refresh when the TOTP window changes rather than when the countdown
      // hits `period`: a 1s interval can skip seconds (throttled hidden
      // webview, sleep, drift), which would leave an expired code on screen.
      let lastWindow = totpWindow(account.period);
      timerRef.current = setInterval(() => {
        setRemaining(timeRemaining(account.period));
        const w = totpWindow(account.period);
        if (w !== lastWindow) { lastWindow = w; generate(); }
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [account, generate]);


  const isTotp = account.type === 'totp';
  const accentClass = isTotp ? 'border-l-emerald-500' : 'border-l-indigo-500';
  // HOTP's indigo has no tone equivalent: it reads as "the other kind", not as a
  // status, so the accent tone is the closest thing the palette offers.
  const typeTone: BadgeTone = isTotp ? 'success' : 'accent';

  return (
    <div className={cn('border border-l-4 rounded-lg bg-card overflow-hidden flex flex-col', accentClass)}>

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div
          className="w-ctl h-ctl rounded-sm flex items-center justify-center text-white text-[11px] font-bold shrink-0 select-none"
          style={avatarStyle(account.name)}
        >
          {initials(account.name)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight truncate">{account.name || m('account')}</p>
          {account.issuer && (
            <p className="text-[11px] text-fg-mute truncate leading-tight mt-0.5">{account.issuer}</p>
          )}
        </div>
        <Badge tone={typeTone} size="sm" uppercase pill>{account.type}</Badge>
      </div>

      {/* ── Code ── */}
      <div className="px-4 pb-4">
        {error ? (
          <div className="flex items-center gap-2 py-2">
            <span className="text-xs text-bad">{error}</span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <CodeDisplay code={code} digits={account.digits} />

            <div className="flex items-center gap-1 shrink-0 ml-auto">
              {isTotp && <CountdownRing remaining={remaining} period={account.period} />}
              {!isTotp && (
                <span className="text-[11px] text-fg-mute font-mono tabular-nums">
                  #{account.counter}
                </span>
              )}
              <CopyButton
                value={() => code}
                disabled={!code}
                variant="ghost"
                size="icon"
                className="h-ctl w-ctl"
                iconClassName="h-4 w-4"
                title={m('copyCode')}
                aria-label={m('copyCode')}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Progress bar (TOTP only) ── */}
      {isTotp && !error && (() => {
        const pct = (remaining / account.period) * 100;
        const barColor = remaining <= 5 ? 'bg-bad' : remaining <= 10 ? 'bg-warn' : 'bg-ok';
        return (
          <div className="h-[3px] w-full bg-bg-2 shrink-0">
            <div
              className={cn('h-full transition-all duration-1000', barColor)}
              style={{ width: `${pct}%` }}
            />
          </div>
        );
      })()}

      {/* ── HOTP next-code row ── */}
      {!isTotp && !error && (
        <div className="px-4 py-2 border-t bg-bg-2/30 shrink-0">
          <Button
            variant="ghost" size="sm"
            className="h-ctl w-full text-xs gap-1.5 text-acc-ink hover:bg-acc-tint"
            onClick={() => onCounterIncrement(account.id)}
          >
            <RefreshCw className="h-3 w-3" />
            {m('nextCode')}
            <ArrowRight className="h-3 w-3 ml-auto" />
          </Button>
        </div>
      )}

      {/* ── Footer ── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-t bg-bg-2/20 shrink-0">
        <div className="flex flex-wrap gap-1 flex-1">
          {([account.algorithm, m('digitsTag', { n: account.digits }), isTotp ? `${account.period}s` : null] as (string | null)[])
            .filter(Boolean)
            .map((tag) => (
              <span key={tag} className="text-[11px] px-1.5 py-0.5 rounded bg-bg-2 text-fg-mute font-mono">
                {tag}
              </span>
            ))}
        </div>
        <Button
          variant="ghost" size="icon"
          className="h-ctl w-ctl text-fg-mute hover:text-fg"
          onClick={() => setShowSecret((s) => !s)}
          title={showSecret ? m('hideSecret') : m('revealSecret')}
          aria-label={showSecret ? m('hideSecret') : m('revealSecret')}
          aria-pressed={showSecret}
        >
          {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost" size="icon"
          className="h-ctl w-ctl text-fg-mute hover:text-bad"
          onClick={() => onDelete(account.id)}
          title={m('removeAccount')}
          aria-label={m('removeAccount')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* ── Secret reveal ── */}
      {showSecret && (
        <div className="px-4 pb-3 pt-1 border-t bg-bg-2/10">
          <p className="text-[11px] font-mono text-fg-mute break-all bg-bg-2/60 rounded-md px-2.5 py-2 border leading-relaxed">
            {account.secret || '(empty)'}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Live preview in the add form ─────────────────────────────────────────────

function LivePreview({ secret, type, period, digits, algorithm, counter }: {
  secret: string; type: OTPType; period: number; digits: number; algorithm: Algorithm; counter: number;
}) {
  const m = useMessages(MESSAGES);
  const [preview, setPreview] = useState('');
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!secret.trim()) { setPreview(''); setErr(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const bytes = base32Decode(secret);
        const code = type === 'hotp'
          ? await computeHOTP(bytes, counter, digits, algorithm)
          : await computeTOTP(bytes, period, digits, algorithm);
        if (!cancelled) { setPreview(code); setErr(false); }
      } catch {
        if (!cancelled) { setPreview(''); setErr(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [secret, type, period, digits, algorithm, counter]);

  if (!secret.trim()) return null;

  return (
    <div className={cn(
      'flex items-center gap-2 px-3 py-2 rounded-md text-xs',
      err ? 'bg-bad-tint text-bad' : 'bg-ok-tint text-ok',
    )}>
      {err ? (
        <span>{m('invalidBase32')}</span>
      ) : (
        <>
          <span className="text-fg-mute">{m('preview')}</span>
          <span className="font-mono font-bold tracking-widest">{preview}</span>
        </>
      )}
    </div>
  );
}

// ─── Add Account Form ─────────────────────────────────────────────────────────

interface AddAccountFormProps {
  onAdd: (account: Account) => void;
  onCancel: () => void;
}

function AddAccountForm({ onAdd, onCancel }: AddAccountFormProps) {
  const m = useMessages(MESSAGES);
  const [name, setName] = useState('');
  const [issuer, setIssuer] = useState('');
  const [secret, setSecret] = useState('');
  const [algorithm, setAlgorithm] = useState<Algorithm>('SHA-1');
  const [digits, setDigits] = useState<6 | 8>(6);
  const [period, setPeriod] = useState<30 | 60>(30);
  const [type, setType] = useState<OTPType>('totp');
  const [error, setError] = useState('');
  const secretRef = useRef<HTMLInputElement>(null);

  useEffect(() => { secretRef.current?.focus(); }, []);

  const handleAdd = () => {
    if (!secret.trim()) { setError(m('secretRequired')); return; }
    try {
      base32Decode(secret);
    } catch (e) {
      setError(e instanceof Error ? e.message : m('invalidBase32'));
      return;
    }
    onAdd({
      id: crypto.randomUUID(),
      name: name.trim() || m('account'),
      issuer: issuer.trim(),
      secret: secret.trim().replace(/\s/g, '').toUpperCase(),
      algorithm, digits, period, type,
      counter: 0,
    });
  };

  const handleKeyDown = (e: { key: string }) => {
    if (e.key === 'Enter') handleAdd();
    if (e.key === 'Escape') onCancel();
  };

  const isTotp = type === 'totp';

  return (
    <div className="border rounded-lg overflow-hidden bg-card" onKeyDown={handleKeyDown}>
      {/* Form header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-bg-2/20">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-fg-mute" />
          <span className="text-sm font-semibold">{m('addAccount')}</span>
        </div>
        {/* Type pill toggle */}
        <div className="flex rounded-md border bg-bg-2/50 p-0.5 gap-0.5">
          {(['totp', 'hotp'] as OTPType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={cn(
                'px-3 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider transition-all duration-150',
                type === t
                  ? t === 'totp'
                    ? 'bg-[var(--cat-4)] text-white shadow-sm'
                    : 'bg-[var(--cat-3)] text-white shadow-sm'
                  : 'text-fg-mute hover:text-fg',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Name + Issuer */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">{m('accountName')}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isTotp ? m('namePlaceholderTotp') : m('namePlaceholderHotp')}
              className="h-ctl text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{m('issuer')} <span className="text-fg-mute">{m('optional')}</span></Label>
            <Input
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder={m('issuerPlaceholder')}
              className="h-ctl text-sm"
            />
          </div>
        </div>

        {/* Secret */}
        <div className="space-y-2">
          <Label className="text-xs">{m('secretKey')} <span className="text-fg-mute">(Base32)</span></Label>
          <Input
            ref={secretRef}
            value={secret}
            onChange={(e) => { setSecret(e.target.value); setError(''); }}
            placeholder="JBSWY3DPEHPK3PXP"
            className={cn('h-ctl text-sm font-mono', error && 'border-bad focus-visible:ring-bad/30')}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
          />
          {error && <p className="text-[11px] text-bad">{error}</p>}
          <LivePreview
            secret={secret} type={type} period={period}
            digits={digits} algorithm={algorithm} counter={0}
          />
        </div>

        {/* Options row */}
        <div className={cn('grid gap-3', isTotp ? 'grid-cols-3' : 'grid-cols-2')}>
          <div className="space-y-1.5">
            <Label className="text-xs">{m('algorithm')}</Label>
            <Select value={algorithm} onValueChange={(v) => setAlgorithm(v as Algorithm)}>
              <SelectTrigger className="h-ctl text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SHA-1">SHA-1</SelectItem>
                <SelectItem value="SHA-256">SHA-256</SelectItem>
                <SelectItem value="SHA-512">SHA-512</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{m('digits')}</Label>
            <Select value={String(digits)} onValueChange={(v) => setDigits(Number(v) as 6 | 8)}>
              <SelectTrigger className="h-ctl text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="6">{m('digitsOption', { n: 6 })}</SelectItem>
                <SelectItem value="8">{m('digitsOption', { n: 8 })}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isTotp && (
            <div className="space-y-1.5">
              <Label className="text-xs">{m('period')}</Label>
              <Select value={String(period)} onValueChange={(v) => setPeriod(Number(v) as 30 | 60)}>
                <SelectTrigger className="h-ctl text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">{m('seconds', { n: 30 })}</SelectItem>
                  <SelectItem value="60">{m('seconds', { n: 60 })}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>{m('cancel')}</Button>
          <Button size="sm" onClick={handleAdd} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            {m('addAccount')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

// ─── Info panel ───────────────────────────────────────────────────────────────

function InfoPanel() {
  const m = useMessages(MESSAGES);
  return (
    <div className="rounded-lg border bg-bg-2/30 p-4 text-xs space-y-3 text-fg-mute leading-relaxed">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--cat-4)]">
            {m('totpTitle')}
          </p>
          <p>
            {m('totpBody')} <code className="bg-bg-2 px-1 rounded font-mono">⌊time / period⌋</code>.
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--cat-3)]">
            {m('hotpTitle')}
          </p>
          <p>
            {m('hotpBody')}
          </p>
        </div>
      </div>
      <p className="border-t pt-2">
        {m('storeBefore')} <strong className="text-fg">{m('storeStrong')}</strong>{m('storeAfter')}
      </p>
    </div>
  );
}

// ─── QR decode (for Google Authenticator / app export screenshots) ─────────────

async function decodeQrFile(file: File): Promise<string | null> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error('read failed'));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('image failed'));
    i.src = dataUrl;
  });
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, w, h);
  const jsQR = (await import('jsqr')).default;
  return jsQR(data, width, height)?.data ?? null;
}

// ─── Export ────────────────────────────────────────────────────────────────────

function buildOtpauthUri(a: Account): string {
  const label = encodeURIComponent(a.issuer ? `${a.issuer}:${a.name}` : a.name);
  const params = new URLSearchParams();
  params.set('secret', a.secret);
  if (a.issuer) params.set('issuer', a.issuer);
  params.set('algorithm', a.algorithm.replace('-', ''));
  params.set('digits', String(a.digits));
  if (a.type === 'totp') params.set('period', String(a.period));
  else params.set('counter', String(a.counter));
  return `otpauth://${a.type}/${label}?${params.toString()}`;
}

// Saved with `saveTextFile` (the OS Save dialog on desktop), because
// `<a download>` writes nothing in the Tauri webview (see lib/fileio.ts).
// This export is the only backup of the secrets.
function exportAccounts(sdk: Parameters<typeof saveTextFile>[0], accounts: Account[]) {
  const body = accounts.map(buildOtpauthUri).join('\n') + '\n';
  return saveTextFile(sdk, `2fa-export-${new Date().toISOString().slice(0, 10)}.txt`, body);
}

// ─── Import dialog ──────────────────────────────────────────────────────────────

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImport: (entries: ParsedOtp[]) => void;
}

function ImportDialog({ open, onOpenChange, onImport }: ImportDialogProps) {
  const sdk = usePluginSdk();
  const m = useMessages(MESSAGES);
  const [rawText, setRawText] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseOtpImport(rawText), [rawText]);

  useEffect(() => { setSelected(new Set(parsed.map((_, i) => i))); }, [parsed]);
  useEffect(() => {
    if (!open) { setRawText(''); setFileError(''); setBusy(false); setDragOver(false); }
  }, [open]);

  const ingestFiles = async (files: FileList | File[]) => {
    setBusy(true); setFileError('');
    const collected: string[] = [];
    let imageWithoutQr = false;
    try {
      for (const file of Array.from(files)) {
        if (file.type.startsWith('image/')) {
          const txt = await decodeQrFile(file);
          if (txt) collected.push(txt); else imageWithoutQr = true;
        } else {
          collected.push(await file.text());
        }
      }
      const joined = collected.join('\n');
      if (joined.trim()) {
        setRawText((prev) => (prev.trim() ? prev + '\n' : '') + joined);
      } else if (imageWithoutQr) {
        setFileError(m('noQrInImage'));
      } else {
        setFileError(m('noOtpData'));
      }
    } catch {
      setFileError(m('readFilesFailed'));
    } finally {
      setBusy(false);
    }
  };

  // Through the SDK (Tauri clipboard plugin): navigator.clipboard in
  // WKWebView shows a "Paste" permission bubble first.
  const handlePasteClipboard = async () => {
    try {
      const text = await sdk.clipboard.readText();
      if (text) setRawText((prev) => (prev.trim() ? prev + '\n' : '') + text);
    } catch {
      setFileError(m('clipboardBlocked'));
    }
  };

  const toggle = (i: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const allSelected = parsed.length > 0 && selected.size === parsed.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(parsed.map((_, i) => i)));

  const confirm = () => {
    onImport(parsed.filter((_, i) => selected.has(i)));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" /> {m('importAccounts')}
          </DialogTitle>
          <DialogDescription>
            {m('importDescBefore')} <code className="font-mono text-[11px]">otpauth://</code> {m('importDescAfter')}
          </DialogDescription>
        </DialogHeader>

        {/* Drop zone */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) ingestFiles(e.dataTransfer.files); }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors',
            dragOver ? 'border-acc bg-acc/5' : 'border-line hover:border-fg-mute/40 hover:bg-bg-2/30',
          )}
        >
          {busy ? (
            <Spinner size="lg" className="text-fg-mute" />
          ) : (
            <div className="flex items-center gap-2 text-fg-mute">
              <QrCode className="h-6 w-6" />
              <FileText className="h-6 w-6" />
            </div>
          )}
          <p className="text-xs font-medium">
            {busy ? m('reading') : m('dropHere')}
          </p>
          <p className="text-[11px] text-fg-mute">{m('dropFormats')}</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.txt,.json,text/plain,application/json"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) ingestFiles(e.target.files); e.target.value = ''; }}
          />
        </div>

        {/* Paste box */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">{m('orPaste')}</Label>
            <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1 px-2" onClick={handlePasteClipboard}>
              <ClipboardPaste className="h-3 w-3" /> {m('paste')}
            </Button>
          </div>
          <TextEditor
            value={rawText}
            onChange={(v) => { setRawText(v); setFileError(''); }}
            placeholder={'otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&issuer=Example\notpauth-migration://offline?data=…'}
            className="h-20"
          />
          {fileError && <p className="text-[11px] text-bad">{fileError}</p>}
        </div>

        {/* Parsed preview */}
        {parsed.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">
                {m(parsed.length === 1 ? 'foundOne' : 'found', { n: parsed.length })}
              </span>
              <button type="button" onClick={toggleAll} className="text-[11px] text-acc hover:underline">
                {allSelected ? m('deselectAll') : m('selectAll')}
              </button>
            </div>
            <div className="max-h-44 overflow-y-auto rounded-md border divide-y">
              {parsed.map((entry, i) => {
                const checked = selected.has(i);
                return (
                  <button
                    key={i}
                    onClick={() => toggle(i)}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-bg-2/40 transition-colors"
                  >
                    <span className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                      checked ? 'bg-acc border-acc' : 'border-line',
                    )}>
                      {checked && <Check className="h-3 w-3 text-acc-fg" />}
                    </span>
                    <div
                      className="w-ctl h-ctl rounded-sm flex items-center justify-center text-white text-[11px] font-bold shrink-0"
                      style={avatarStyle(entry.name)}
                    >
                      {initials(entry.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{entry.name}</p>
                      {entry.issuer && <p className="text-[11px] text-fg-mute truncate">{entry.issuer}</p>}
                    </div>
                    <span className={cn(
                      'text-[11px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0',
                      entry.type === 'totp'
                        ? 'bg-[hsl(var(--cat-4-c)/0.12)] text-[var(--cat-4)]'
                        : 'bg-[hsl(var(--cat-3-c)/0.12)] text-[var(--cat-3)]',
                    )}>
                      {entry.type}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>{m('cancel')}</Button>
          <Button size="sm" onClick={confirm} disabled={selected.size === 0} className="gap-1.5">
            <Download className="h-3.5 w-3.5" />
            {selected.size > 0 ? m('importN', { n: selected.size }) : m('import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function TwoFactorAuth() {
  const m = useMessages(MESSAGES);
  // TOTP/HOTP seeds live in the secret vault, not the shared store. The
  // vault is async: until `ready`, never render "no accounts", which
  // would look like data loss.
  const sdk = usePluginSdk();
  const [accounts, setAccounts, accountsReady] = useSecretState<Account[]>(sdk, 'accounts', []);
  const [showForm, setShowForm] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [filter, setFilter] = useState<'all' | OTPType>('all');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  const flashNotice = (msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 4000);
  };

  const handleAdd = (account: Account) => {
    setAccounts((prev) => [...prev, account]);
    setShowForm(false);
  };

  // Deleting an account loses its secret for good (no undo) and can lock
  // the user out of the real account, so always confirm.
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);
  const handleDelete = (id: string) => {
    setPendingDelete(accounts.find((a) => a.id === id) ?? null);
  };
  const confirmDelete = () => {
    if (pendingDelete) setAccounts((prev) => prev.filter((a) => a.id !== pendingDelete.id));
    setPendingDelete(null);
  };

  const handleCounterIncrement = (id: string) => {
    setAccounts((prev) => prev.map((a) => a.id === id ? { ...a, counter: a.counter + 1 } : a));
  };

  const handleImport = (entries: ParsedOtp[]) => {
    setAccounts((prev) => {
      const existing = new Set(prev.map((a) => `${a.type}:${a.secret}:${a.name}`));
      let added = 0, skipped = 0;
      const next = [...prev];
      for (const e of entries) {
        const key = `${e.type}:${e.secret}:${e.name}`;
        if (existing.has(key)) { skipped++; continue; }
        existing.add(key);
        next.push({
          id: crypto.randomUUID(),
          name: e.name,
          issuer: e.issuer,
          secret: e.secret,
          algorithm: e.algorithm,
          digits: e.digits,
          period: e.period,
          type: e.type,
          counter: e.counter,
        });
        added++;
      }
      flashNotice(
        added > 0
          ? (skipped ? m('importedSkipped', { n: added, skipped }) : m(added === 1 ? 'importedOne' : 'imported', { n: added }))
          : m('noneNew', { skipped }),
      );
      return next;
    });
  };

  const totpCount = accounts.filter((a) => a.type === 'totp').length;
  const hotpCount = accounts.filter((a) => a.type === 'hotp').length;

  const filtered = accounts.filter((a) => {
    if (filter !== 'all' && a.type !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!a.name.toLowerCase().includes(q) && !a.issuer.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="tool-full-height">
      <div className="tool-scrollable tool-padding tool-spacer">

        {/* ── Toolbar ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-ok shrink-0" />
            <div>
              <h2 className="text-sm font-semibold leading-tight">{m('title')}</h2>
              <p className="text-[11px] text-fg-mute">{m('subtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost" size="sm"
              className="h-ctl text-xs gap-1 text-fg-mute"
              onClick={() => setShowInfo((s) => !s)}
            >
              {showInfo ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {m('info')}
            </Button>
            {accounts.length > 0 && (
              <Button
                variant="ghost" size="icon"
                className="h-ctl w-ctl text-fg-mute"
                onClick={() => {
                  exportAccounts(sdk, accounts).catch((e) => flashNotice(m('exportFailed', { error: (e as Error).message })));
                }}
                title={m('exportAll')}
                aria-label={m('exportAll')}
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="outline" size="sm"
              className="h-ctl text-xs gap-1.5"
              onClick={() => setShowImport(true)}
            >
              <Upload className="h-3.5 w-3.5" />
              {m('import')}
            </Button>
            <Button
              size="sm"
              className="h-ctl text-xs gap-1.5"
              onClick={() => { setShowForm((s) => !s); }}
            >
              <Plus className="h-3.5 w-3.5" />
              {m('add')}
            </Button>
          </div>
        </div>

        {/* ── Notice ── */}
        {notice && (
          <div className="flex items-center gap-2 rounded-md bg-ok-tint text-ok px-3 py-2 text-xs ring-1 ring-ok-edge">
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {/* ── Info ── */}
        {showInfo && <InfoPanel />}

        {/* ── Import dialog ── */}
        <ImportDialog open={showImport} onOpenChange={setShowImport} onImport={handleImport} />

        {/* ── Add form ── */}
        {showForm && (
          <AddAccountForm onAdd={handleAdd} onCancel={() => setShowForm(false)} />
        )}

        {/* ── Filter row: tabs + search ── */}
        {accounts.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {totpCount > 0 && hotpCount > 0 && (
              <div className="flex items-center gap-1">
                {([
                  { key: 'all', label: m('all', { n: accounts.length }) },
                  { key: 'totp', label: `TOTP (${totpCount})` },
                  { key: 'hotp', label: `HOTP (${hotpCount})` },
                ] as { key: typeof filter; label: string }[]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                      filter === key
                        ? 'bg-acc text-acc-fg'
                        : 'text-fg-mute hover:text-fg hover:bg-acc/50',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {accounts.length > 3 && (
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder={m('searchPlaceholder')}
                className="h-ctl text-xs"
                containerClassName="ml-auto w-full sm:w-56"
              />
            )}
          </div>
        )}

        {/* ── Account grid ── */}
        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((account) => (
              <OTPCard
                key={account.id}
                account={account}
                onDelete={handleDelete}
                onCounterIncrement={handleCounterIncrement}
              />
            ))}
          </div>
        ) : !accountsReady ? (
          <div className="py-8 text-center text-xs text-fg-mute">{m('loadingAccounts')}</div>
        ) : accounts.length === 0 && !showForm ? (
          <EmptyState
            icon={ShieldCheck}
            title={m('emptyTitle')}
            description={m('emptyDesc')}
            action={{ label: m('emptyAction'), onClick: () => setShowForm(true) }}
          />
        ) : filtered.length === 0 && accounts.length > 0 ? (
          <div className="text-center py-8 text-xs text-fg-mute">
            {search.trim() ? (
              <>{m('noMatch', { q: search })}{' '}
                <button type="button" className="underline hover:text-fg" onClick={() => setSearch('')}>{m('clearSearch')}</button></>
            ) : (
              <>{m('noType', { type: filter.toUpperCase() })}{' '}
                <button type="button" className="underline hover:text-fg" onClick={() => setFilter('all')}>{m('showAll')}</button></>
            )}
          </div>
        ) : null}

      </div>
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title={m('removeTitle')}
        description={m('removeDesc', { name: pendingDelete ? [pendingDelete.issuer, pendingDelete.name].filter(Boolean).join(' · ') : m('thisAccount') })}
        confirmLabel={m('remove')}
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
