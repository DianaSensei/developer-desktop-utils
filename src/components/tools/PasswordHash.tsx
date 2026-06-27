// Password hashing — bcrypt and Argon2 (id/i/d) hashing + verification, the
// password-hash algorithms a backend dev reaches for when seeding a users table
// or debugging auth. Runs on hash-wasm (WASM bundled inline → fully offline).
// Hashing is expensive by design, so it runs on an explicit button, not live.

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Segmented } from '@/components/ui/segmented';
import { CopyButton } from '@/components/ui/copy-button';
import { ToolSection, ToolLabel, ToolHint } from '@/components/ui/tool-section';
import { Eye, EyeOff, Fingerprint, Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePersistentState } from '@/hooks/usePersistentState';

type Mode = 'hash' | 'verify';
type Algo = 'bcrypt' | 'argon2id' | 'argon2i' | 'argon2d';

const ALGOS: { value: Algo; label: string }[] = [
  { value: 'bcrypt', label: 'bcrypt' },
  { value: 'argon2id', label: 'Argon2id' },
  { value: 'argon2i', label: 'Argon2i' },
  { value: 'argon2d', label: 'Argon2d' },
];

function randomSalt(len = 16): Uint8Array {
  const s = new Uint8Array(len);
  crypto.getRandomValues(s);
  return s;
}

export function PasswordHash() {
  const [mode, setMode] = usePersistentState<Mode>('devtool:pwhash:mode', 'hash');
  const [algo, setAlgo] = usePersistentState<Algo>('devtool:pwhash:algo', 'bcrypt');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  // bcrypt params
  const [cost, setCost] = usePersistentState('devtool:pwhash:cost', 10);
  // argon2 params
  const [memory, setMemory] = usePersistentState('devtool:pwhash:memory', 19456); // KiB (OWASP)
  const [iterations, setIterations] = usePersistentState('devtool:pwhash:iters', 2);
  const [parallelism, setParallelism] = usePersistentState('devtool:pwhash:par', 1);

  // hash mode result
  const [hashOut, setHashOut] = useState('');
  // verify mode
  const [verifyHash, setVerifyHash] = useState('');
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runHash = async () => {
    setBusy(true); setError(null); setHashOut('');
    try {
      const salt = randomSalt(16);
      if (algo === 'bcrypt') {
        const { bcrypt } = await import('hash-wasm');
        setHashOut(await bcrypt({ password, salt, costFactor: Math.max(4, Math.min(cost, 20)), outputType: 'encoded' }));
      } else {
        const m = await import('hash-wasm');
        const fn = algo === 'argon2id' ? m.argon2id : algo === 'argon2i' ? m.argon2i : m.argon2d;
        setHashOut(await fn({
          password,
          salt,
          parallelism: Math.max(1, parallelism),
          iterations: Math.max(1, iterations),
          memorySize: Math.max(8, memory),
          hashLength: 32,
          outputType: 'encoded',
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hashing failed');
    } finally {
      setBusy(false);
    }
  };

  const runVerify = async () => {
    setBusy(true); setError(null); setVerifyResult(null);
    try {
      const hash = verifyHash.trim();
      let ok: boolean;
      if (/^\$2[aby]?\$/.test(hash)) {
        const { bcryptVerify } = await import('hash-wasm');
        ok = await bcryptVerify({ password, hash });
      } else if (/^\$argon2(id|i|d)\$/.test(hash)) {
        const { argon2Verify } = await import('hash-wasm');
        ok = await argon2Verify({ password, hash });
      } else {
        throw new Error('Unrecognized hash — expected a bcrypt ($2b$…) or Argon2 ($argon2id$…) string.');
      }
      setVerifyResult(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tool-full-height">
      {/* Mode switcher */}
      <div className="shrink-0 header-premium px-4 py-2.5 flex items-center gap-3">
        <Segmented
          value={mode}
          onValueChange={(v) => { setMode(v); setError(null); }}
          options={[
            { value: 'hash', label: 'Hash' },
            { value: 'verify', label: 'Verify' },
          ]}
          aria-label="Mode"
        />
        <span className="hidden text-xs text-muted-foreground sm:block">
          {mode === 'hash' ? 'Hash a password with a random salt.' : 'Check a password against an existing hash (algorithm auto-detected).'}
        </span>
      </div>

      <div className="tool-scrollable tool-padding tool-spacer">
        {mode === 'hash' && (
          <>
            {/* Algorithm + params */}
            <div className="flex flex-wrap items-center gap-3">
              <Select value={algo} onValueChange={(v) => setAlgo(v as Algo)}>
                <SelectTrigger className="h-8 w-40 text-xs rounded-lg"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALGOS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>

              {algo === 'bcrypt' ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Cost</span>
                  <Input type="number" min={4} max={20} value={cost} onChange={(e) => setCost(parseInt(e.target.value) || 10)} className="h-8 w-20 text-xs rounded-lg" />
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Memory (KiB)</span>
                    <Input type="number" min={8} value={memory} onChange={(e) => setMemory(parseInt(e.target.value) || 8)} className="h-8 w-24 text-xs rounded-lg" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Iterations</span>
                    <Input type="number" min={1} value={iterations} onChange={(e) => setIterations(parseInt(e.target.value) || 1)} className="h-8 w-20 text-xs rounded-lg" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Parallelism</span>
                    <Input type="number" min={1} value={parallelism} onChange={(e) => setParallelism(parseInt(e.target.value) || 1)} className="h-8 w-20 text-xs rounded-lg" />
                  </div>
                </>
              )}
            </div>

            <ToolSection>
              <ToolLabel>Password</ToolLabel>
              <ToolHint>A random salt is generated for each hash, so the output changes every time.</ToolHint>
              <div className="relative">
                <Input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter a password to hash…"
                  className="h-9 pr-9 font-mono text-sm"
                  onKeyDown={(e) => { if (e.key === 'Enter' && password) void runHash(); }}
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </ToolSection>

            <Button onClick={() => void runHash()} disabled={!password || busy} size="sm" className="gap-1.5">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Fingerprint className="h-3.5 w-3.5" />}
              {busy ? 'Hashing…' : 'Hash password'}
            </Button>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {hashOut && (
              <ToolSection>
                <div className="flex items-center justify-between">
                  <ToolLabel>Hash</ToolLabel>
                  <CopyButton value={hashOut} label="Copy" variant="ghost" size="sm" className="h-6 px-2 text-xs" iconClassName="h-3 w-3" />
                </div>
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <p className="break-all font-mono text-xs text-foreground/90">{hashOut}</p>
                </div>
              </ToolSection>
            )}
          </>
        )}

        {mode === 'verify' && (
          <>
            <ToolSection>
              <ToolLabel>Password</ToolLabel>
              <div className="relative">
                <Input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setVerifyResult(null); }}
                  placeholder="Enter the password…"
                  className="h-9 pr-9 font-mono text-sm"
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </ToolSection>

            <ToolSection>
              <ToolLabel>Hash</ToolLabel>
              <ToolHint>Paste a bcrypt ($2b$…) or Argon2 ($argon2id$…) hash — the algorithm is detected automatically.</ToolHint>
              <Input
                value={verifyHash}
                onChange={(e) => { setVerifyHash(e.target.value); setVerifyResult(null); }}
                placeholder="$2b$10$… or $argon2id$v=19$…"
                className="h-9 font-mono text-xs"
              />
            </ToolSection>

            <Button onClick={() => void runVerify()} disabled={!password || !verifyHash.trim() || busy} size="sm" className="gap-1.5">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {busy ? 'Verifying…' : 'Verify'}
            </Button>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {verifyResult !== null && (
              <div className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium',
                verifyResult
                  ? 'border-green-500/30 bg-green-500/8 text-green-600 dark:text-green-400'
                  : 'border-destructive/30 bg-destructive/8 text-destructive',
              )}>
                {verifyResult ? <><Check className="h-4 w-4" /> Match — the password matches this hash.</> : <><X className="h-4 w-4" /> No match.</>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
