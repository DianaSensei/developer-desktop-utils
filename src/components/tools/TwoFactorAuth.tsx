import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  ShieldCheck, Copy, Check, Plus, Trash2, Eye, EyeOff,
  RefreshCw, KeyRound, ChevronDown, ChevronUp, ArrowRight,
  Upload, Download, QrCode, FileText, Search, X, Loader2, ClipboardPaste,
} from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils';
import { usePersistentState } from '@/hooks/usePersistentState';
import { base32Decode, parseOtpImport, type ParsedOtp } from '@/lib/otpauth';

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

const AVATAR_COLORS = [
  'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-lime-500',
  'bg-emerald-500', 'bg-teal-500', 'bg-cyan-500', 'bg-sky-500',
  'bg-blue-500', 'bg-violet-500', 'bg-purple-500', 'bg-pink-500',
];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
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
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="2.5" className="stroke-muted" />
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
      <span className="text-muted-foreground/40 text-lg font-light select-none">·</span>
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
  const [code, setCode] = useState('');
  const [remaining, setRemaining] = useState(account.period);
  const [copied, setCopied] = useState(false);
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
      setError(e instanceof Error ? e.message : 'Invalid secret');
    }
  }, [account]);

  useEffect(() => {
    generate();
    if (account.type === 'totp') {
      setRemaining(timeRemaining(account.period));
      timerRef.current = setInterval(() => {
        const r = timeRemaining(account.period);
        setRemaining(r);
        if (r === account.period) generate();
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [account, generate]);

  const handleCopy = async () => {
    if (!code) return;
    await copyToClipboard(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const isTotp = account.type === 'totp';
  const accentClass = isTotp ? 'border-l-emerald-500' : 'border-l-indigo-500';
  const typePillClass = isTotp
    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20'
    : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-500/20';

  return (
    <div className={cn('border border-l-4 rounded-lg bg-card overflow-hidden flex flex-col', accentClass)}>

      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <div className={cn(
          'w-9 h-9 rounded-lg flex items-center justify-center text-white text-[11px] font-bold shrink-0 select-none',
          avatarColor(account.name),
        )}>
          {initials(account.name)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight truncate">{account.name || 'Account'}</p>
          {account.issuer && (
            <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">{account.issuer}</p>
          )}
        </div>
        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0', typePillClass)}>
          {account.type}
        </span>
      </div>

      {/* ── Code ── */}
      <div className="px-4 pb-4">
        {error ? (
          <div className="flex items-center gap-2 py-2">
            <span className="text-xs text-destructive">{error}</span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <CodeDisplay code={code} digits={account.digits} />

            <div className="flex items-center gap-1 shrink-0 ml-auto">
              {isTotp && <CountdownRing remaining={remaining} period={account.period} />}
              {!isTotp && (
                <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                  #{account.counter}
                </span>
              )}
              <Button
                variant="ghost" size="icon"
                className={cn('h-8 w-8 transition-colors', copied && 'text-emerald-500')}
                onClick={handleCopy}
                disabled={!code}
                title="Copy code"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Progress bar (TOTP only) ── */}
      {isTotp && !error && (() => {
        const pct = (remaining / account.period) * 100;
        const barColor = remaining <= 5 ? 'bg-red-500' : remaining <= 10 ? 'bg-amber-500' : 'bg-emerald-500';
        return (
          <div className="h-[3px] w-full bg-muted shrink-0">
            <div
              className={cn('h-full transition-all duration-1000', barColor)}
              style={{ width: `${pct}%` }}
            />
          </div>
        );
      })()}

      {/* ── HOTP next-code row ── */}
      {!isTotp && !error && (
        <div className="px-4 py-2 border-t bg-muted/30 shrink-0">
          <Button
            variant="ghost" size="sm"
            className="h-7 w-full text-xs gap-1.5 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10"
            onClick={() => onCounterIncrement(account.id)}
          >
            <RefreshCw className="h-3 w-3" />
            Generate Next Code
            <ArrowRight className="h-3 w-3 ml-auto" />
          </Button>
        </div>
      )}

      {/* ── Footer ── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-t bg-muted/20 shrink-0">
        <div className="flex flex-wrap gap-1 flex-1">
          {([account.algorithm, `${account.digits} digits`, isTotp ? `${account.period}s` : null] as (string | null)[])
            .filter(Boolean)
            .map((tag) => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                {tag}
              </span>
            ))}
        </div>
        <Button
          variant="ghost" size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => setShowSecret((s) => !s)}
          title={showSecret ? 'Hide secret' : 'Reveal secret'}
        >
          {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost" size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(account.id)}
          title="Remove account"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* ── Secret reveal ── */}
      {showSecret && (
        <div className="px-4 pb-3 pt-1 border-t bg-muted/10">
          <p className="text-[11px] font-mono text-muted-foreground break-all bg-muted/60 rounded-md px-2.5 py-2 border leading-relaxed">
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
      err ? 'bg-destructive/10 text-destructive' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    )}>
      {err ? (
        <span>Invalid Base32 secret</span>
      ) : (
        <>
          <span className="text-muted-foreground">Preview:</span>
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
    if (!secret.trim()) { setError('Secret key is required'); return; }
    try {
      base32Decode(secret);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid Base32 secret');
      return;
    }
    onAdd({
      id: crypto.randomUUID(),
      name: name.trim() || 'Account',
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
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Add Account</span>
        </div>
        {/* Type pill toggle */}
        <div className="flex rounded-md border bg-muted/50 p-0.5 gap-0.5">
          {(['totp', 'hotp'] as OTPType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={cn(
                'px-3 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider transition-all duration-150',
                type === t
                  ? t === 'totp'
                    ? 'bg-emerald-500 text-white shadow-sm'
                    : 'bg-indigo-500 text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
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
            <Label className="text-xs">Account Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isTotp ? 'e.g. GitHub, AWS, Google' : 'e.g. FIDO key'}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Issuer <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="e.g. github.com"
              className="h-8 text-sm"
            />
          </div>
        </div>

        {/* Secret */}
        <div className="space-y-2">
          <Label className="text-xs">Secret Key <span className="text-muted-foreground">(Base32)</span></Label>
          <Input
            ref={secretRef}
            value={secret}
            onChange={(e) => { setSecret(e.target.value); setError(''); }}
            placeholder="JBSWY3DPEHPK3PXP"
            className={cn('h-8 text-sm font-mono', error && 'border-destructive focus-visible:ring-destructive/30')}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
          />
          {error && <p className="text-[11px] text-destructive">{error}</p>}
          <LivePreview
            secret={secret} type={type} period={period}
            digits={digits} algorithm={algorithm} counter={0}
          />
        </div>

        {/* Options row */}
        <div className={cn('grid gap-3', isTotp ? 'grid-cols-3' : 'grid-cols-2')}>
          <div className="space-y-1.5">
            <Label className="text-xs">Algorithm</Label>
            <Select value={algorithm} onValueChange={(v) => setAlgorithm(v as Algorithm)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SHA-1">SHA-1</SelectItem>
                <SelectItem value="SHA-256">SHA-256</SelectItem>
                <SelectItem value="SHA-512">SHA-512</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Digits</Label>
            <Select value={String(digits)} onValueChange={(v) => setDigits(Number(v) as 6 | 8)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6 digits</SelectItem>
                <SelectItem value="8">8 digits</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isTotp && (
            <div className="space-y-1.5">
              <Label className="text-xs">Period</Label>
              <Select value={String(period)} onValueChange={(v) => setPeriod(Number(v) as 30 | 60)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 seconds</SelectItem>
                  <SelectItem value="60">60 seconds</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={handleAdd} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Add Account
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-4 px-4">
      <div className="relative">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground/40" />
        </div>
        <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
          <KeyRound className="h-3 w-3 text-primary-foreground" />
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold">No accounts yet</p>
        <p className="text-xs text-muted-foreground max-w-[240px]">
          Add a TOTP or HOTP account using the Base32 secret from your authenticator app setup.
        </p>
      </div>
      <Button size="sm" onClick={onAdd} className="gap-1.5 mt-1">
        <Plus className="h-3.5 w-3.5" />
        Add First Account
      </Button>
    </div>
  );
}

// ─── Info panel ───────────────────────────────────────────────────────────────

function InfoPanel() {
  return (
    <div className="rounded-lg border bg-muted/30 p-4 text-xs space-y-3 text-muted-foreground leading-relaxed">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            TOTP — Time-based (RFC 6238)
          </p>
          <p>
            Generates a new code every 30 or 60 seconds.
            Used by Google Authenticator, Authy, 1Password, and most sites.
            Counter = <code className="bg-muted px-1 rounded font-mono">⌊time / period⌋</code>.
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            HOTP — Counter-based (RFC 4226)
          </p>
          <p>
            Generates a code from a monotonic counter you advance manually.
            Each tap of "Generate Next Code" increments the counter and produces a new code.
          </p>
        </div>
      </div>
      <p className="border-t pt-2">
        Secrets are stored in <strong className="text-foreground">localStorage</strong> only — nothing leaves your device.
        Secrets must be Base32-encoded (A–Z and 2–7, case-insensitive, spaces ignored).
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

function exportAccounts(accounts: Account[]) {
  const body = accounts.map(buildOtpauthUri).join('\n') + '\n';
  const blob = new Blob([body], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `2fa-export-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Import dialog ──────────────────────────────────────────────────────────────

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImport: (entries: ParsedOtp[]) => void;
}

function ImportDialog({ open, onOpenChange, onImport }: ImportDialogProps) {
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
        setFileError('No QR code found in the selected image.');
      } else {
        setFileError('No OTP data found in the selected file(s).');
      }
    } catch {
      setFileError('Could not read one or more files.');
    } finally {
      setBusy(false);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setRawText((prev) => (prev.trim() ? prev + '\n' : '') + text);
    } catch {
      setFileError('Clipboard access was blocked. Paste into the box instead.');
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
            <Upload className="h-4 w-4" /> Import Accounts
          </DialogTitle>
          <DialogDescription>
            Import a Google Authenticator export QR, or <code className="font-mono text-[11px]">otpauth://</code> URIs
            from any app (2FAS, Aegis, Authy, Raivo…). Everything is parsed locally.
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
            dragOver ? 'border-primary bg-primary/5' : 'border-input hover:border-muted-foreground/40 hover:bg-muted/30',
          )}
        >
          {busy ? (
            <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground">
              <QrCode className="h-6 w-6" />
              <FileText className="h-6 w-6" />
            </div>
          )}
          <p className="text-xs font-medium">
            {busy ? 'Reading…' : 'Drop QR image or export file here'}
          </p>
          <p className="text-[11px] text-muted-foreground">PNG · JPG · .txt · .json — or click to browse</p>
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
            <Label className="text-xs">Or paste URIs</Label>
            <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1 px-2" onClick={handlePasteClipboard}>
              <ClipboardPaste className="h-3 w-3" /> Paste
            </Button>
          </div>
          <Textarea
            value={rawText}
            onChange={(e) => { setRawText(e.target.value); setFileError(''); }}
            placeholder="otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&issuer=Example
otpauth-migration://offline?data=…"
            className="h-20 text-[11px] font-mono resize-none"
            spellCheck={false}
          />
          {fileError && <p className="text-[11px] text-destructive">{fileError}</p>}
        </div>

        {/* Parsed preview */}
        {parsed.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">
                Found {parsed.length} account{parsed.length === 1 ? '' : 's'}
              </span>
              <button onClick={toggleAll} className="text-[11px] text-primary hover:underline">
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="max-h-44 overflow-y-auto rounded-md border divide-y">
              {parsed.map((entry, i) => {
                const checked = selected.has(i);
                return (
                  <button
                    key={i}
                    onClick={() => toggle(i)}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                  >
                    <span className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                      checked ? 'bg-primary border-primary' : 'border-input',
                    )}>
                      {checked && <Check className="h-3 w-3 text-primary-foreground" />}
                    </span>
                    <div className={cn(
                      'w-7 h-7 rounded-md flex items-center justify-center text-white text-[10px] font-bold shrink-0',
                      avatarColor(entry.name),
                    )}>
                      {initials(entry.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{entry.name}</p>
                      {entry.issuer && <p className="text-[10px] text-muted-foreground truncate">{entry.issuer}</p>}
                    </div>
                    <span className={cn(
                      'text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0',
                      entry.type === 'totp'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
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
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={confirm} disabled={selected.size === 0} className="gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Import {selected.size > 0 ? selected.size : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function TwoFactorAuth() {
  const [accounts, setAccounts] = usePersistentState<Account[]>('devtool:2fa:accounts', []);
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

  const handleDelete = (id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
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
          ? `Imported ${added} account${added === 1 ? '' : 's'}${skipped ? ` · ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped` : ''}.`
          : `No new accounts — ${skipped} already exist${skipped === 1 ? 's' : ''}.`,
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
            <ShieldCheck className="h-5 w-5 text-emerald-500 shrink-0" />
            <div>
              <h2 className="text-sm font-semibold leading-tight">2FA Authenticator</h2>
              <p className="text-[11px] text-muted-foreground">TOTP · HOTP · SHA-1/256/512 · 6 or 8 digits</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost" size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground"
              onClick={() => setShowInfo((s) => !s)}
            >
              {showInfo ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              About
            </Button>
            {accounts.length > 0 && (
              <Button
                variant="ghost" size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={() => exportAccounts(accounts)}
                title="Export all accounts (otpauth URIs)"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="outline" size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => setShowImport(true)}
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => { setShowForm((s) => !s); }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>
        </div>

        {/* ── Notice ── */}
        {notice && (
          <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-3 py-2 text-xs ring-1 ring-emerald-500/20">
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
                  { key: 'all', label: `All (${accounts.length})` },
                  { key: 'totp', label: `TOTP (${totpCount})` },
                  { key: 'hotp', label: `HOTP (${hotpCount})` },
                ] as { key: typeof filter; label: string }[]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                      filter === key
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {accounts.length > 3 && (
              <div className="relative ml-auto w-full sm:w-56">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search accounts…"
                  className="h-7 pl-8 pr-7 text-xs"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
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
        ) : accounts.length === 0 && !showForm ? (
          <EmptyState onAdd={() => setShowForm(true)} />
        ) : filtered.length === 0 && accounts.length > 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            {search.trim() ? (
              <>No accounts match "{search}".{' '}
                <button className="underline hover:text-foreground" onClick={() => setSearch('')}>Clear search</button></>
            ) : (
              <>No {filter.toUpperCase()} accounts.{' '}
                <button className="underline hover:text-foreground" onClick={() => setFilter('all')}>Show all</button></>
            )}
          </div>
        ) : null}

      </div>
    </div>
  );
}
