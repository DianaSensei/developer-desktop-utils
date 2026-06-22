import { useDeferredValue, useMemo, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Copy, Eye, EyeOff, Lock, ArrowLeftRight, Check, X, KeyRound } from 'lucide-react';
import { ToolSection, ToolLabel, ToolHint } from '@/components/ui/tool-section';
import CryptoJS from 'crypto-js';
import { cn } from '@/lib/utils';
import { usePersistentState } from '@/hooks/usePersistentState';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import { copyToClipboard } from '@/lib/clipboard';

type Tab = 'hash' | 'encrypt';
type AesMode = 'encrypt' | 'decrypt';

const ALGORITHMS = [
  { id: 'md5',    label: 'MD5',     bits: 128, chars: 32,  desc: 'Fast · avoid for passwords, OK for checksums' },
  { id: 'sha1',   label: 'SHA-1',   bits: 160, chars: 40,  desc: 'Legacy · not recommended for new projects' },
  { id: 'sha256', label: 'SHA-256', bits: 256, chars: 64,  desc: 'Recommended · file integrity, tokens, APIs' },
  { id: 'sha512', label: 'SHA-512', bits: 512, chars: 128, desc: 'Maximum strength · best security, slower' },
] as const;

type AlgoId = (typeof ALGORITHMS)[number]['id'];

function computeHash(id: AlgoId, input: string): string {
  switch (id) {
    case 'md5':    return CryptoJS.MD5(input).toString();
    case 'sha1':   return CryptoJS.SHA1(input).toString();
    case 'sha256': return CryptoJS.SHA256(input).toString();
    case 'sha512': return CryptoJS.SHA512(input).toString();
  }
}

function computeHmac(id: AlgoId, input: string, key: string): string {
  switch (id) {
    case 'md5':    return CryptoJS.HmacMD5(input, key).toString();
    case 'sha1':   return CryptoJS.HmacSHA1(input, key).toString();
    case 'sha256': return CryptoJS.HmacSHA256(input, key).toString();
    case 'sha512': return CryptoJS.HmacSHA512(input, key).toString();
  }
}

export function HashTool() {
  const [tab, setTab] = usePersistentState<Tab>('devtool:hash:tab', 'hash');
  const [hashInput, setHashInput] = usePersistentState('devtool:hash:hashInput', '');
  const [encryptInput, setEncryptInput] = usePersistentState('devtool:hash:encryptInput', '');
  const [encryptKey, setEncryptKey] = usePersistentState('devtool:hash:key', '');
  const [aesMode, setAesMode] = usePersistentState<AesMode>('devtool:hash:aesMode', 'encrypt');
  const [upperHex, setUpperHex] = usePersistentState('devtool:hash:upperHex', false);
  const [hmacKey, setHmacKey] = usePersistentState('devtool:hash:hmacKey', '');
  const [showKey, setShowKey] = useState(false);
  const [showHmacKey, setShowHmacKey] = useState(false);
  const [verifyAlgo, setVerifyAlgo] = useState<AlgoId | null>(null);
  const [verifyValue, setVerifyValue] = useState('');

  useQuickPaste(setHashInput, tab === 'hash');
  useQuickPaste(setEncryptInput, tab === 'encrypt');
  useInputHistory(hashInput, setHashInput, tab === 'hash');
  useInputHistory(encryptInput, setEncryptInput, tab === 'encrypt');

  const deferredHash = useDeferredValue(hashInput);
  const deferredEncrypt = useDeferredValue(encryptInput);

  const hashes = useMemo((): Record<AlgoId, string> => {
    if (!deferredHash) return { md5: '', sha1: '', sha256: '', sha512: '' };
    const raw = {
      md5:    computeHash('md5',    deferredHash),
      sha1:   computeHash('sha1',   deferredHash),
      sha256: computeHash('sha256', deferredHash),
      sha512: computeHash('sha512', deferredHash),
    };
    return upperHex
      ? { md5: raw.md5.toUpperCase(), sha1: raw.sha1.toUpperCase(), sha256: raw.sha256.toUpperCase(), sha512: raw.sha512.toUpperCase() }
      : raw;
  }, [deferredHash, upperHex]);

  const hmacs = useMemo((): Record<AlgoId, string> => {
    if (!deferredHash || !hmacKey) return { md5: '', sha1: '', sha256: '', sha512: '' };
    const raw = {
      md5:    computeHmac('md5',    deferredHash, hmacKey),
      sha1:   computeHmac('sha1',   deferredHash, hmacKey),
      sha256: computeHmac('sha256', deferredHash, hmacKey),
      sha512: computeHmac('sha512', deferredHash, hmacKey),
    };
    return upperHex
      ? { md5: raw.md5.toUpperCase(), sha1: raw.sha1.toUpperCase(), sha256: raw.sha256.toUpperCase(), sha512: raw.sha512.toUpperCase() }
      : raw;
  }, [deferredHash, hmacKey, upperHex]);

  const aesResult = useMemo(() => {
    if (!deferredEncrypt || !encryptKey) return { output: '', error: '' };
    try {
      if (aesMode === 'encrypt') {
        return { output: CryptoJS.AES.encrypt(deferredEncrypt, encryptKey).toString(), error: '' };
      }
      const bytes = CryptoJS.AES.decrypt(deferredEncrypt, encryptKey);
      const text = bytes.toString(CryptoJS.enc.Utf8);
      return text ? { output: text, error: '' } : { output: '', error: 'Invalid key or ciphertext' };
    } catch {
      return { output: '', error: 'Decryption failed — check your key and ciphertext' };
    }
  }, [deferredEncrypt, encryptKey, aesMode]);

  const verifyMatch = useMemo(() => {
    if (!verifyAlgo || !verifyValue.trim() || !hashes[verifyAlgo]) return null;
    return verifyValue.trim().toLowerCase() === hashes[verifyAlgo].toLowerCase();
  }, [verifyAlgo, verifyValue, hashes]);

  const toggleVerify = (id: AlgoId) => {
    if (verifyAlgo === id) {
      setVerifyAlgo(null);
      setVerifyValue('');
    } else {
      setVerifyAlgo(id);
      setVerifyValue('');
    }
  };

  return (
    <div className="tool-full-height">
      <div className="tool-scrollable tool-padding tool-spacer">

        {/* Tab navigation */}
        <div className="inline-flex h-9 rounded-lg border border-border bg-muted/50 p-0.5">
          <button
            type="button"
            onClick={() => setTab('hash')}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-4 text-sm font-medium transition-all duration-150',
              tab === 'hash' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Lock className="h-3.5 w-3.5" />
            Hash
          </button>
          <button
            type="button"
            onClick={() => setTab('encrypt')}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-4 text-sm font-medium transition-all duration-150',
              tab === 'encrypt' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Encrypt
          </button>
        </div>

        {/* ── Hash tab ────────────────────────────────────────────────── */}
        {tab === 'hash' && (
          <>
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30">
              <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                One-way · The same input always produces the same digest, but the original text cannot be recovered.
              </p>
            </div>

            <ToolSection>
              <ToolLabel>Input Text</ToolLabel>
              <ToolHint>{quickPasteHint}</ToolHint>
              <Textarea
                value={hashInput}
                onChange={(e) => setHashInput(e.target.value)}
                placeholder="Enter text to hash…"
                className="min-h-[100px] font-mono text-sm"
              />
            </ToolSection>

            {/* Results header with case toggle */}
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Hash Results</p>
              <button
                type="button"
                onClick={() => setUpperHex((v) => !v)}
                title={upperHex ? 'Switch to lowercase' : 'Switch to uppercase'}
                className={cn(
                  'text-[11px] font-mono px-2 py-0.5 rounded border transition-colors',
                  upperHex
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-border/80'
                )}
              >
                {upperHex ? 'ABC' : 'abc'}
              </button>
            </div>

            <div className="space-y-2">
              {ALGORITHMS.map(({ id, label, bits, chars, desc }) => {
                const value = hashes[id];
                const isVerifying = verifyAlgo === id;
                return (
                  <div key={id} className="rounded-lg border border-border bg-muted/20 overflow-hidden">
                    {/* Main row */}
                    <div className="flex items-center gap-3 px-3 pt-2.5 pb-1 group">
                      <div className="shrink-0 w-20">
                        <p className="text-xs font-semibold text-foreground leading-none mb-0.5">{label}</p>
                        <p className="text-[10px] text-muted-foreground">{bits}-bit</p>
                      </div>
                      <Input
                        value={value}
                        readOnly
                        className="flex-1 h-7 font-mono text-xs border-0 bg-transparent p-0 focus-visible:ring-0 text-muted-foreground"
                        placeholder={`${chars} hex chars`}
                      />
                      <div className={cn(
                        'shrink-0 flex items-center gap-1 transition-opacity',
                        isVerifying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      )}>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={!value}
                          onClick={() => copyToClipboard(value)}
                          className="h-7 w-7"
                          title="Copy"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant={isVerifying ? 'secondary' : 'ghost'}
                          disabled={!value}
                          onClick={() => toggleVerify(id)}
                          className="h-7 w-7"
                          title="Verify hash"
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    {/* Algorithm description */}
                    <p className="text-[10px] text-muted-foreground/60 px-3 pb-2">{desc}</p>

                    {/* Inline verify panel */}
                    {isVerifying && (
                      <div className="px-3 pb-3 border-t border-border/50 pt-2.5 space-y-2">
                        <p className="text-[11px] text-muted-foreground font-medium">Verify {label} hash</p>
                        <div className="flex items-center gap-2">
                          <Input
                            value={verifyValue}
                            onChange={(e) => setVerifyValue(e.target.value)}
                            placeholder="Paste a hash to compare…"
                            className="h-7 font-mono text-xs flex-1"
                            autoFocus
                          />
                          {verifyValue.trim() && verifyMatch !== null && (
                            <div className={cn(
                              'flex items-center gap-1 text-xs font-medium shrink-0',
                              verifyMatch ? 'text-green-600 dark:text-green-400' : 'text-destructive'
                            )}>
                              {verifyMatch
                                ? <><Check className="h-3.5 w-3.5" /> Match</>
                                : <><X className="h-3.5 w-3.5" /> No match</>
                              }
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── HMAC section ─────────────────────────────────────────── */}
            <ToolSection>
              <div className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                <ToolLabel>HMAC — Keyed Hash</ToolLabel>
              </div>
              <ToolHint>Combines your text with a secret key · used for API authentication and message signing</ToolHint>
              <div className="relative">
                <Input
                  type={showHmacKey ? 'text' : 'password'}
                  value={hmacKey}
                  onChange={(e) => setHmacKey(e.target.value)}
                  placeholder="Enter HMAC secret key…"
                  className="h-8 text-sm pr-9 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowHmacKey((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showHmacKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {hmacKey ? (
                <div className="space-y-2">
                  {ALGORITHMS.map(({ id, label, bits, chars }) => {
                    const value = hmacs[id];
                    return (
                      <div key={id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-muted/20 group">
                        <div className="shrink-0 w-24">
                          <p className="text-xs font-semibold text-foreground leading-none mb-0.5">HMAC-{label}</p>
                          <p className="text-[10px] text-muted-foreground">{bits}-bit</p>
                        </div>
                        <Input
                          value={value}
                          readOnly
                          className="flex-1 h-7 font-mono text-xs border-0 bg-transparent p-0 focus-visible:ring-0 text-muted-foreground"
                          placeholder={`${chars} hex chars`}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={!value}
                          onClick={() => copyToClipboard(value)}
                          className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Copy"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground/50 text-center py-2">
                  Enter a key above to generate HMAC signatures
                </p>
              )}
            </ToolSection>
          </>
        )}

        {/* ── Encrypt tab ─────────────────────────────────────────────── */}
        {tab === 'encrypt' && (
          <>
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-50/80 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/30">
              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
              <p className="text-xs text-blue-700 dark:text-blue-400">
                Reversible · AES-256 ciphertext can be fully recovered with the correct key.
              </p>
            </div>

            {/* Mode + algorithm label */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="inline-flex h-8 rounded-lg border border-border bg-muted/50 p-0.5">
                {(['encrypt', 'decrypt'] as AesMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAesMode(mode)}
                    className={cn(
                      'rounded-md px-3.5 text-xs font-medium capitalize transition-all duration-150',
                      aesMode === mode
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">AES-256 · CBC</span>
            </div>

            {/* Encryption key */}
            <ToolSection>
              <ToolLabel>Encryption Key</ToolLabel>
              <ToolHint>Use a strong, secret passphrase</ToolHint>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={encryptKey}
                  onChange={(e) => setEncryptKey(e.target.value)}
                  placeholder="Enter passphrase…"
                  className="h-8 text-sm pr-9 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </ToolSection>

            {/* Input */}
            <ToolSection>
              <ToolLabel>{aesMode === 'encrypt' ? 'Plaintext' : 'Ciphertext'}</ToolLabel>
              <ToolHint>{quickPasteHint}</ToolHint>
              <Textarea
                value={encryptInput}
                onChange={(e) => setEncryptInput(e.target.value)}
                placeholder={
                  aesMode === 'encrypt'
                    ? 'Enter text to encrypt…'
                    : 'Paste base64 ciphertext to decrypt…'
                }
                className="min-h-[100px] font-mono text-sm"
              />
            </ToolSection>

            {/* Output */}
            {(aesResult.output || aesResult.error) && (
              <ToolSection>
                <div className="flex items-center justify-between">
                  <ToolLabel>{aesMode === 'encrypt' ? 'Ciphertext' : 'Plaintext'}</ToolLabel>
                  {aesResult.output && (
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => copyToClipboard(aesResult.output)}>
                      <Copy className="h-3 w-3 mr-1" />Copy
                    </Button>
                  )}
                </div>
                {aesResult.error ? (
                  <div className="px-3 py-2.5 bg-destructive/8 border border-destructive/20 rounded-lg">
                    <p className="text-sm text-destructive">{aesResult.error}</p>
                  </div>
                ) : (
                  <Textarea value={aesResult.output} readOnly className="min-h-[80px] font-mono text-xs" />
                )}
              </ToolSection>
            )}
          </>
        )}

      </div>
    </div>
  );
}
