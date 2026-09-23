import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, BadgeCheck, FileSignature, PenLine, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Segmented } from '@/components/ui/segmented';
import { Callout } from '@/components/ui/callout';
import { CopyButton } from '@/components/ui/copy-button';
import { PaneHeader, ToolToolbar } from '@/components/ui/tool-layout';
import { CodeViewer } from '@/design-system';
import { JsonEditor } from '@/components/ui/code-editor';
import { usePluginSdk, usePluginState, useSecretState } from '@/platform';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import {
  decodeToken, generateKeyPairPem, inspectClaims, isAsymmetric, isHmac, signToken, verifyToken,
  type JwtAlgorithm, type SecretEncoding, type VerifyOutcome,
} from './jwtCrypto';
import { AlgorithmSelect, ClaimTable, EmptyHint, KeyField, useAlgorithmSupport } from './jwtParts';

type Mode = 'decode' | 'verify' | 'sign';

const MODES = [
  { value: 'decode' as const, label: 'Decode', icon: FileSignature },
  { value: 'verify' as const, label: 'Verify', icon: ShieldCheck },
  { value: 'sign' as const, label: 'Sign', icon: PenLine },
];

const SAMPLE_PAYLOAD = JSON.stringify({ sub: '1234567890', name: 'Jane Doe', role: 'admin' }, null, 2);

export function JwtDebugger() {
  // A JWT pasted into a debugger is usually a REAL bearer token, and the keys
  // below are the credentials that mint them — both belong in the secret
  // vault, not the shared key plane every module in the webview can read.
  // Everything else here (mode, algorithm, the claims being drafted) is
  // ordinary preference state.
  const sdk = usePluginSdk();
  const [token, setToken, tokenReady] = useSecretState(sdk, 'token', '');
  const [secret, setSecret] = useSecretState(sdk, 'hmac-secret', '');
  const [privateKey, setPrivateKey] = useSecretState(sdk, 'private-key', '');
  const [publicKey, setPublicKey] = useSecretState(sdk, 'public-key', '');

  const [mode, setMode] = usePluginState<Mode>(sdk, 'mode', 'decode');
  const [algorithm, setAlgorithm] = usePluginState<JwtAlgorithm>(sdk, 'algorithm', 'HS256');
  const [encoding, setEncoding] = usePluginState<SecretEncoding>(sdk, 'secret-encoding', 'utf8');
  const [payload, setPayload] = usePluginState(sdk, 'sign-payload', SAMPLE_PAYLOAD);
  const [kid, setKid] = usePluginState(sdk, 'sign-kid', '');
  const [expiresIn, setExpiresIn] = usePluginState(sdk, 'sign-expires-in', '1h');
  const [issuer, setIssuer] = usePluginState(sdk, 'verify-issuer', '');
  const [audience, setAudience] = usePluginState(sdk, 'verify-audience', '');
  const [clockTolerance, setClockTolerance] = usePluginState(sdk, 'verify-clock-tolerance', '0');

  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  const [signed, setSigned] = useState('');
  const [signError, setSignError] = useState('');
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);

  const support = useAlgorithmSupport();

  useQuickPaste(setToken, mode !== 'sign');
  useInputHistory(token, setToken, mode !== 'sign');

  const decoded: Decoded = useMemo(() => {
    if (!token.trim()) return null;
    try {
      const parts = decodeToken(token);
      return { ok: true, ...parts, claims: inspectClaims(parts.payload) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Invalid JWT token' };
    }
  }, [token]);

  // The key box shows the secret for HMAC and the right half of the pair
  // otherwise — so generating a pair in Sign leaves Verify already filled in.
  const keyValue = isHmac(algorithm) ? secret : mode === 'sign' ? privateKey : publicKey;
  const setKeyValue = isHmac(algorithm) ? setSecret : mode === 'sign' ? setPrivateKey : setPublicKey;

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const pair = await generateKeyPairPem(algorithm);
      setPrivateKey(pair.privateKey);
      setPublicKey(pair.publicKey);
      setSignError('');
    } catch (e) {
      setSignError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [algorithm, setPrivateKey, setPublicKey]);

  const handleVerify = useCallback(async () => {
    setBusy(true);
    try {
      const tolerance = Number(clockTolerance);
      setOutcome(await verifyToken({
        token,
        algorithm,
        key: {
          material: isHmac(algorithm) ? secret : publicKey,
          encoding,
          // Lets a whole JWKS be pasted: the token names which key signed it.
          kid: decoded?.ok && typeof decoded.header.kid === 'string' ? decoded.header.kid : undefined,
        },
        issuer: issuer.trim(),
        audience: audience.trim(),
        clockToleranceSec: Number.isFinite(tolerance) && tolerance > 0 ? tolerance : undefined,
      }));
    } finally {
      setBusy(false);
    }
  }, [token, algorithm, secret, publicKey, encoding, decoded, issuer, audience, clockTolerance]);

  const handleSign = useCallback(async () => {
    setBusy(true);
    setSignError('');
    try {
      const jwt = await signToken({
        algorithm,
        payload,
        expiresIn: expiresIn.trim() || undefined,
        header: kid.trim() ? { kid: kid.trim() } : undefined,
        key: { material: isHmac(algorithm) ? secret : privateKey, encoding },
      });
      setSigned(jwt);
    } catch (e) {
      setSigned('');
      setSignError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [algorithm, payload, expiresIn, kid, secret, privateKey, encoding]);

  return (
    <div className="flex h-full flex-col">
      <ToolToolbar className="flex flex-wrap items-center gap-2">
        <Segmented value={mode} onValueChange={(m) => { setMode(m); setOutcome(null); }} options={MODES} aria-label="JWT mode" />
        {mode !== 'decode' && (
          <>
            <AlgorithmSelect value={algorithm} onChange={(a) => { setAlgorithm(a); setOutcome(null); }} support={support} />
            <Button
              size="sm"
              className="h-ctl text-xs"
              onClick={mode === 'verify' ? handleVerify : handleSign}
              disabled={busy || (mode === 'verify' && !token.trim())}
            >
              {mode === 'verify' ? 'Verify signature' : 'Sign token'}
            </Button>
          </>
        )}
      </ToolToolbar>

      {mode !== 'sign' && (
        <div className="flex shrink-0 flex-col border-b border-line" style={{ height: '150px' }}>
          <PaneHeader label="JWT Token" hint={quickPasteHint} action={token ? <CopyButton value={token} variant="ghost" size="sm" className="h-ctl text-[11px]" /> : undefined} />
          <Textarea
            value={token}
            onChange={(e) => { setToken(e.target.value); setOutcome(null); }}
            spellCheck={false}
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            className="min-h-0 flex-1 resize-none rounded-none border-0 p-4 font-mono text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        {mode === 'decode' && <DecodeBody decoded={decoded} tokenReady={tokenReady} />}

        {mode === 'verify' && (
          <>
            <KeyField
              algorithm={algorithm}
              purpose="verify"
              value={keyValue}
              onChange={setKeyValue}
              encoding={encoding}
              onEncodingChange={setEncoding}
              onGenerate={handleGenerate}
              generating={generating}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <LabelledInput label="Expected issuer (iss)" value={issuer} onChange={setIssuer} placeholder="https://auth.example.com" />
              <LabelledInput label="Expected audience (aud)" value={audience} onChange={setAudience} placeholder="my-api" />
              <LabelledInput label="Clock tolerance (s)" value={clockTolerance} onChange={setClockTolerance} placeholder="0" />
            </div>
            <VerifyResult outcome={outcome} />
            {decoded?.ok && <ClaimTable rows={decoded.claims.rows} />}
          </>
        )}

        {mode === 'sign' && (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-fg">Payload (claims)</span>
                <span className="text-[11px] text-fg-mute">iat is set automatically</span>
              </div>
              <div className="flex min-h-[200px] flex-col overflow-hidden rounded-md border border-line">
                <JsonEditor value={payload} onChange={setPayload} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <LabelledInput label="Expires in" value={expiresIn} onChange={setExpiresIn} placeholder="1h, 7d, 3600 — blank for no exp" />
              <LabelledInput label="Key ID (kid header)" value={kid} onChange={setKid} placeholder="optional" />
            </div>
            <KeyField
              algorithm={algorithm}
              purpose="sign"
              value={keyValue}
              onChange={setKeyValue}
              encoding={encoding}
              onEncodingChange={setEncoding}
              onGenerate={handleGenerate}
              generating={generating}
            />
            {isAsymmetric(algorithm) && publicKey && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-fg">Public key (for whoever verifies)</span>
                  <CopyButton value={publicKey} variant="ghost" size="sm" className="h-ctl text-[11px]" />
                </div>
                <Textarea value={publicKey} onChange={(e) => setPublicKey(e.target.value)} spellCheck={false} className="min-h-[80px] resize-y font-mono text-xs" />
              </div>
            )}
            {signError && <Callout tone="error">{signError}</Callout>}
            {algorithm === 'none' && (
              <Callout tone="warning" size="sm" title="Unsigned token">
                <code className="font-mono">alg: none</code> produces a token with an empty signature. Anyone can edit its
                claims and it stays &quot;valid&quot; — only useful for testing how a server reacts to one.
              </Callout>
            )}
            {signed && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-fg">Signed token</span>
                  <span className="inline-flex items-center gap-1.5">
                    <Button variant="outline" size="sm" className="h-ctl text-[11px]" onClick={() => { setToken(signed); setMode('decode'); }}>
                      Open in Decode
                    </Button>
                    <CopyButton value={signed} variant="ghost" size="sm" className="h-ctl text-[11px]" />
                  </span>
                </div>
                <Textarea value={signed} readOnly spellCheck={false} className="min-h-[92px] resize-y break-all font-mono text-xs" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LabelledInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="space-y-1.5">
      <span className="block text-xs font-medium text-fg">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-ctl text-xs" spellCheck={false} />
    </label>
  );
}

type Decoded =
  | { ok: true; header: Record<string, unknown>; payload: unknown; signature: string; claims: ReturnType<typeof inspectClaims> }
  | { ok: false; error: string }
  | null;

function DecodeBody({ decoded, tokenReady }: { decoded: Decoded; tokenReady: boolean }) {
  if (!decoded) return <EmptyHint ready={tokenReady} />;
  if (!decoded.ok) return <Callout tone="error">{decoded.error}</Callout>;

  return (
    <>
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-mute">Header</div>
        <div className="flex min-h-[100px] flex-col overflow-hidden rounded-md border border-line bg-sunk">
          <CodeViewer value={JSON.stringify(decoded.header, null, 2)} language="json" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-mute">Payload</div>
        <div className="flex min-h-[180px] flex-col overflow-hidden rounded-md border border-line bg-sunk">
          <CodeViewer value={JSON.stringify(decoded.payload, null, 2)} language="json" />
        </div>
      </div>
      <ClaimTable rows={decoded.claims.rows} />
      {/* The old copy said "this tool does not verify the signature", which is
          no longer true of the tool — only of this pane. Point at the mode
          that does it rather than leaving a dead end. */}
      <Callout tone="warning" size="sm" title="Decoded, not verified">
        Anyone can read or rewrite these claims. Switch to <strong>Verify</strong> with the issuer&apos;s key to find out
        whether the signature actually holds.
      </Callout>
    </>
  );
}

function VerifyResult({ outcome }: { outcome: VerifyOutcome | null }) {
  if (!outcome) {
    return (
      <Callout tone="info" size="sm" icon={false}>
        Pick the algorithm you expect the issuer to use, paste its key, then press Verify. The token&apos;s own
        <code className="mx-1 font-mono">alg</code> header is never trusted to choose for you.
      </Callout>
    );
  }
  if (outcome.valid) {
    return <Callout tone="success" icon={BadgeCheck} title="Signature valid">{outcome.message}</Callout>;
  }
  // "Expired" and "wrong audience" mean the signature itself held — a red
  // "invalid" on those reads as "forged", which is a different problem with a
  // different fix.
  const tone = outcome.code === 'expired' || outcome.code === 'nbf' || outcome.code === 'claim' ? 'warning' : 'error';
  const title = outcome.code === 'expired' ? 'Expired'
    : outcome.code === 'nbf' ? 'Not valid yet'
      : outcome.code === 'claim' ? 'Claim check failed'
        : outcome.code === 'alg' ? 'Algorithm mismatch'
          : outcome.code === 'key' ? 'Key problem'
            : 'Signature invalid';
  return <Callout tone={tone} icon={AlertTriangle} title={title}>{outcome.message}</Callout>;
}
