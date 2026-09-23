import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CopyButton } from '@/components/ui/copy-button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  JWT_ALGORITHMS, SECRET_ENCODINGS, algorithmSpec, isAlgorithmSupported, isAsymmetric, isHmac,
  type ClaimRow, type JwtAlgorithm, type SecretEncoding,
} from './jwtCrypto';

/**
 * Which algorithms this webview can actually perform.
 *
 * Asked once per mount and answered by the engine itself — see
 * `isAlgorithmSupported`. Until the probe resolves everything reads as
 * available, so the picker never flickers items out from under the cursor on
 * the overwhelmingly common path where they all work.
 */
export function useAlgorithmSupport(): Record<string, boolean> {
  const [support, setSupport] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      JWT_ALGORITHMS.map(async ({ alg }) => [alg, await isAlgorithmSupported(alg)] as const),
    ).then((pairs) => {
      if (!cancelled) setSupport(Object.fromEntries(pairs));
    });
    return () => { cancelled = true; };
  }, []);

  return support;
}

export function AlgorithmSelect({ value, onChange, support }: {
  value: JwtAlgorithm;
  onChange: (alg: JwtAlgorithm) => void;
  support: Record<string, boolean>;
}) {
  // Grouped by family: fourteen flat entries is a wall, and the grouping is
  // the thing that answers "which one do I even want" (shared secret vs key
  // pair) before the digest size does.
  const families = [...new Map(JWT_ALGORITHMS.map((a) => [a.family, a.familyLabel])).entries()];

  return (
    <Select value={value} onValueChange={(v) => onChange(v as JwtAlgorithm)}>
      <SelectTrigger className="h-ctl w-[132px] text-xs" aria-label="Signing algorithm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {families.map(([family, label]) => (
          <SelectGroup key={family}>
            <SelectLabel className="text-[11px]">{label}</SelectLabel>
            {JWT_ALGORITHMS.filter((a) => a.family === family).map(({ alg }) => {
              const unsupported = support[alg] === false;
              return (
                <SelectItem
                  key={alg}
                  value={alg}
                  disabled={unsupported}
                  className="text-xs"
                  title={unsupported ? `${alg} is not available in this webview's Web Crypto` : undefined}
                >
                  {alg}{unsupported ? ' — unavailable here' : ''}
                </SelectItem>
              );
            })}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

export function KeyField({
  algorithm, purpose, value, onChange, encoding, onEncodingChange, onGenerate, generating,
}: {
  algorithm: JwtAlgorithm;
  purpose: 'sign' | 'verify';
  value: string;
  onChange: (v: string) => void;
  encoding: SecretEncoding;
  onEncodingChange: (e: SecretEncoding) => void;
  /** Only offered for key-pair algorithms. */
  onGenerate?: () => void;
  generating?: boolean;
}) {
  const spec = algorithmSpec(algorithm);
  const hmac = isHmac(algorithm);
  const label = hmac ? 'Shared secret' : purpose === 'sign' ? 'Private key' : 'Public key or certificate';

  if (algorithm === 'none') {
    return (
      <p className="text-[11px] text-fg-mute">
        <code className="font-mono">alg: none</code> takes no key — the token is left unsigned.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-fg">{label}</span>
        {hmac && (
          <Select value={encoding} onValueChange={(v) => onEncodingChange(v as SecretEncoding)}>
            <SelectTrigger className="h-ctl w-[118px] text-[11px]" aria-label="How the secret is encoded">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SECRET_ENCODINGS.map((e) => (
                <SelectItem key={e.value} value={e.value} className="text-xs">{e.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5">
          {value && <CopyButton value={value} variant="ghost" size="sm" className="h-ctl text-[11px]" />}
          {isAsymmetric(algorithm) && onGenerate && (
            <Button variant="outline" size="sm" className="h-ctl gap-1.5 text-[11px]" onClick={onGenerate} disabled={generating}>
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Generate pair
            </Button>
          )}
        </span>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder={hmac ? 'your-256-bit-secret' : purpose === 'sign' ? '-----BEGIN PRIVATE KEY-----' : '-----BEGIN PUBLIC KEY-----'}
        className="min-h-[92px] resize-y font-mono text-xs"
      />
      {spec && <p className="text-[11px] text-fg-mute">{spec.keyHint}</p>}
    </div>
  );
}

const TONE_CLASS: Record<ClaimRow['tone'], string> = {
  neutral: 'text-fg',
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
};

export function ClaimTable({ rows }: { rows: ClaimRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-fg-mute">Registered claims</div>
      <div className="overflow-hidden rounded-md border border-line">
        {rows.map((row, i) => (
          <div
            key={row.claim}
            className={cn('flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5 text-xs', i > 0 && 'border-t border-line')}
          >
            <span className="w-16 shrink-0 font-mono text-[11px] text-fg-mute">{row.claim}</span>
            <span className="w-24 shrink-0 text-[11px] text-fg-mute">{row.label}</span>
            <span className={cn('min-w-0 break-all font-mono', TONE_CLASS[row.tone])}>{row.value}</span>
            {row.detail && <span className={cn('text-[11px]', TONE_CLASS[row.tone])}>({row.detail})</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyHint({ ready }: { ready: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 pt-12 text-center text-fg-mute">
      <KeyRound className="h-12 w-12 text-fg-mute/25" />
      <p className="text-sm font-medium">{ready ? 'Paste a JWT to decode it' : 'Loading…'}</p>
      <p className="text-[11px] text-fg-mute/70">
        Verify and sign with HS/RS/PS/ES256-512, EdDSA — or unsigned <code className="font-mono">none</code>
      </p>
    </div>
  );
}
