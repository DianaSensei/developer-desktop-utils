import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShieldCheck, Copy, Check, Plus, Trash2, Eye, EyeOff, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils';
import { usePersistentState } from '@/hooks/usePersistentState';

// ─── Types ────────────────────────────────────────────────────────────────────

type Algorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';
type OTPType = 'totp' | 'hotp';

interface Account {
  id: string;
  name: string;
  issuer: string;
  secret: string;
  algorithm: Algorithm;
  digits: 6 | 8;
  period: 30 | 60;
  type: OTPType;
  counter: number;
}

// ─── Base32 decode ────────────────────────────────────────────────────────────

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  let output = 0;
  const result = new Uint8Array(Math.floor((clean.length * 5) / 8));

  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_CHARS.indexOf(clean[i]);
    if (idx === -1) throw new Error(`Invalid Base32 character: ${clean[i]}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      result[output++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return result;
}

// ─── HOTP / TOTP computation ──────────────────────────────────────────────────

async function computeHOTP(secret: Uint8Array, counter: number, digits: number, algorithm: Algorithm): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', secret,
    { name: 'HMAC', hash: { name: algorithm } },
    false,
    ['sign'],
  );

  const counterBytes = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = c & 0xff;
    c = Math.floor(c / 256);
  }

  const signature = await crypto.subtle.sign('HMAC', key, counterBytes);
  const hash = new Uint8Array(signature);

  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  return String(code % Math.pow(10, digits)).padStart(digits, '0');
}

async function computeTOTP(secret: Uint8Array, period: number, digits: number, algorithm: Algorithm): Promise<string> {
  const counter = Math.floor(Date.now() / 1000 / period);
  return computeHOTP(secret, counter, digits, algorithm);
}

function timeRemaining(period: number): number {
  const epoch = Math.floor(Date.now() / 1000);
  return period - (epoch % period);
}

// ─── OTP Card ─────────────────────────────────────────────────────────────────

interface OTPCardProps {
  account: Account;
  onDelete: (id: string) => void;
  onCounterIncrement: (id: string) => void;
}

function OTPCard({ account, onDelete, onCounterIncrement }: OTPCardProps) {
  const [code, setCode] = useState('');
  const [remaining, setRemaining] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const generate = useCallback(async () => {
    if (!account.secret.trim()) { setCode(''); setError(''); return; }
    try {
      const secretBytes = base32Decode(account.secret);
      let result: string;
      if (account.type === 'hotp') {
        result = await computeHOTP(secretBytes, account.counter, account.digits, account.algorithm);
      } else {
        result = await computeTOTP(secretBytes, account.period, account.digits, account.algorithm);
      }
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
    setTimeout(() => setCopied(false), 1500);
  };

  const progressPct = account.type === 'totp'
    ? (remaining / account.period) * 100
    : 100;

  const progressColor = remaining <= 5
    ? 'bg-red-500'
    : remaining <= 10
    ? 'bg-amber-500'
    : 'bg-emerald-500';

  const displayCode = code
    ? code.slice(0, Math.ceil(code.length / 2)) + ' ' + code.slice(Math.ceil(code.length / 2))
    : error ? '' : '···  ···';

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{account.name || 'Unnamed'}</p>
          {account.issuer && (
            <p className="text-[11px] text-muted-foreground truncate">{account.issuer}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7"
            onClick={() => setShowSecret((s) => !s)}
            title={showSecret ? 'Hide secret' : 'Show secret'}
          >
            {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
          {account.type === 'hotp' && (
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7"
              onClick={() => onCounterIncrement(account.id)}
              title="Next code (increment counter)"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => onDelete(account.id)}
            title="Remove account"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Code */}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <div className="flex items-center gap-3">
          <span className="font-mono text-2xl font-bold tracking-widest tabular-nums select-all">
            {displayCode}
          </span>
          <Button
            variant="ghost" size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleCopy}
            disabled={!code}
          >
            {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
          </Button>
          {account.type === 'totp' && (
            <span className="text-xs text-muted-foreground tabular-nums ml-auto shrink-0">{remaining}s</span>
          )}
          {account.type === 'hotp' && (
            <span className="text-xs text-muted-foreground ml-auto shrink-0">#{account.counter}</span>
          )}
        </div>
      )}

      {/* Progress bar (TOTP only) */}
      {account.type === 'totp' && !error && (
        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-1000', progressColor)}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* Secret (collapsible) */}
      {showSecret && (
        <p className="text-[11px] font-mono text-muted-foreground break-all bg-muted/50 rounded px-2 py-1">
          {account.secret || '(empty)'}
        </p>
      )}

      {/* Meta badges */}
      <div className="flex flex-wrap gap-1">
        {[
          account.type.toUpperCase(),
          account.algorithm,
          `${account.digits} digits`,
          account.type === 'totp' ? `${account.period}s` : null,
        ].filter(Boolean).map((tag) => (
          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
            {tag}
          </span>
        ))}
      </div>
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

  const validate = () => {
    if (!secret.trim()) { setError('Secret is required'); return false; }
    try { base32Decode(secret); } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid Base32 secret');
      return false;
    }
    return true;
  };

  const handleAdd = () => {
    if (!validate()) return;
    onAdd({
      id: crypto.randomUUID(),
      name: name.trim() || 'Account',
      issuer: issuer.trim(),
      secret: secret.trim().replace(/\s/g, '').toUpperCase(),
      algorithm,
      digits,
      period,
      type,
      counter: 0,
    });
  };

  return (
    <div className="border rounded-lg p-4 space-y-4 bg-card">
      <p className="text-sm font-semibold">Add Account</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Account Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. GitHub, AWS"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Issuer (optional)</Label>
          <Input
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            placeholder="e.g. GitHub"
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Secret Key (Base32)</Label>
        <Input
          value={secret}
          onChange={(e) => { setSecret(e.target.value); setError(''); }}
          placeholder="JBSWY3DPEHPK3PXP"
          className="h-8 text-sm font-mono"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as OTPType)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="totp">TOTP</SelectItem>
              <SelectItem value="hotp">HOTP</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
              <SelectItem value="6">6</SelectItem>
              <SelectItem value="8">8</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {type === 'totp' && (
          <div className="space-y-1.5">
            <Label className="text-xs">Period</Label>
            <Select value={String(period)} onValueChange={(v) => setPeriod(Number(v) as 30 | 60)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30s</SelectItem>
                <SelectItem value="60">60s</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={handleAdd}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function TwoFactorAuth() {
  const [accounts, setAccounts] = usePersistentState<Account[]>('devtool:2fa:accounts', []);
  const [showForm, setShowForm] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const handleAdd = (account: Account) => {
    setAccounts((prev) => [...prev, account]);
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  };

  const handleCounterIncrement = (id: string) => {
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, counter: a.counter + 1 } : a)),
    );
  };

  return (
    <div className="tool-full-height">
      <div className="tool-scrollable tool-padding tool-spacer">

        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-500 shrink-0" />
            <div>
              <h2 className="text-sm font-semibold">2FA Authenticator</h2>
              <p className="text-[11px] text-muted-foreground">TOTP · HOTP · SHA-1/256/512 · 6 or 8 digits</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost" size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setShowInfo((s) => !s)}
            >
              {showInfo ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              How it works
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setShowForm((s) => !s)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Account
            </Button>
          </div>
        </div>

        {/* Info panel */}
        {showInfo && (
          <div className="rounded-lg border bg-muted/40 p-4 text-xs space-y-2 text-muted-foreground leading-relaxed">
            <p>
              <strong className="text-foreground">TOTP</strong> (Time-based OTP, RFC 6238) generates a new code every 30 or 60 seconds
              using <code className="bg-muted px-1 rounded">HMAC(secret, floor(time / period))</code>.
              Used by Google Authenticator, Authy, 1Password, etc.
            </p>
            <p>
              <strong className="text-foreground">HOTP</strong> (HMAC-based OTP, RFC 4226) generates a code from a counter that you
              increment manually. Tap the refresh icon to advance the counter.
            </p>
            <p>
              Secrets are stored in <strong className="text-foreground">localStorage</strong> only — no data leaves your device.
              The secret must be Base32-encoded (letters A–Z and digits 2–7, case-insensitive).
            </p>
          </div>
        )}

        {/* Add account form */}
        {showForm && (
          <AddAccountForm onAdd={handleAdd} onCancel={() => setShowForm(false)} />
        )}

        {/* Account list */}
        {accounts.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {accounts.map((account) => (
              <OTPCard
                key={account.id}
                account={account}
                onDelete={handleDelete}
                onCounterIncrement={handleCounterIncrement}
              />
            ))}
          </div>
        ) : !showForm && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <ShieldCheck className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No accounts yet</p>
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add your first account
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
