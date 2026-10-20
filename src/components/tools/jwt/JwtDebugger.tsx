import { useCallback, useMemo, useState, useId } from 'react';
import { Field } from '@/components/ui/tool-section';
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
import { usePluginSdkFor, usePluginState, useSecretState } from '@/platform';
import { useQuickPaste, useQuickPasteHint } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import {
  decodeToken, generateKeyPairPem, inspectClaims, isAsymmetric, isHmac, signToken, verifyToken,
  type JwtAlgorithm, type SecretEncoding, type VerifyOutcome,
} from './jwtCrypto';
import { AlgorithmSelect, ClaimTable, EmptyHint, KeyField, useAlgorithmSupport } from './jwtParts';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from '@/components/tools/jwt/JwtDebugger.messages';

type Mode = 'decode' | 'verify' | 'sign';

const MODES = [
  { value: 'decode' as const, labelKey: 'decode' as const, icon: FileSignature },
  { value: 'verify' as const, labelKey: 'verify' as const, icon: ShieldCheck },
  { value: 'sign' as const, labelKey: 'sign' as const, icon: PenLine },
];

const SAMPLE_PAYLOAD = JSON.stringify({ sub: '1234567890', name: 'Jane Doe', role: 'admin' }, null, 2);

export function JwtDebugger() {
  const m = useMessages(MESSAGES);
  const quickPasteHint = useQuickPasteHint();
  // A JWT pasted into a debugger is usually a REAL bearer token, and the keys
  // below are the credentials that mint them — both belong in the secret
  // vault, not the shared key plane every module in the webview can read.
  // Everything else here (mode, algorithm, the claims being drafted) is
  // ordinary preference state.
  //
  // The debugger is the JWT tab of Encode·Hash·Encrypt (it used to be its
  // own `jwt` plugin), so its state lives in that plugin under `jwt:`. The
  // vault entries were moved at startup (platform/secrets.ts VAULT_MOVES);
  // `legacyKey` brings the plain preferences along on first read.
  const sdk = usePluginSdkFor('base64');
  const [token, setToken, tokenReady] = useSecretState(sdk, 'jwt:token', '');
  const [secret, setSecret] = useSecretState(sdk, 'jwt:hmac-secret', '');
  const [privateKey, setPrivateKey] = useSecretState(sdk, 'jwt:private-key', '');
  const [publicKey, setPublicKey] = useSecretState(sdk, 'jwt:public-key', '');

  const legacy = (key: string) => ({ legacyKey: `devtool:jwt:${key}` });
  const [mode, setMode] = usePluginState<Mode>(sdk, 'jwt:mode', 'decode', legacy('mode'));
  const [algorithm, setAlgorithm] = usePluginState<JwtAlgorithm>(sdk, 'jwt:algorithm', 'HS256', legacy('algorithm'));
  const [encoding, setEncoding] = usePluginState<SecretEncoding>(sdk, 'jwt:secret-encoding', 'utf8', legacy('secret-encoding'));
  const [payload, setPayload] = usePluginState(sdk, 'jwt:sign-payload', SAMPLE_PAYLOAD, legacy('sign-payload'));
  const [kid, setKid] = usePluginState(sdk, 'jwt:sign-kid', '', legacy('sign-kid'));
  const [expiresIn, setExpiresIn] = usePluginState(sdk, 'jwt:sign-expires-in', '1h', legacy('sign-expires-in'));
  const [issuer, setIssuer] = usePluginState(sdk, 'jwt:verify-issuer', '', legacy('verify-issuer'));
  const [audience, setAudience] = usePluginState(sdk, 'jwt:verify-audience', '', legacy('verify-audience'));
  const [clockTolerance, setClockTolerance] = usePluginState(sdk, 'jwt:verify-clock-tolerance', '0', legacy('verify-clock-tolerance'));

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
        <Segmented value={mode} onValueChange={(m) => { setMode(m); setOutcome(null); }} options={MODES.map(({ labelKey, ...o }) => ({ ...o, label: m(labelKey) }))} aria-label={m('modeLabel')} />
        {mode !== 'decode' && (
          <>
            <AlgorithmSelect value={algorithm} onChange={(a) => { setAlgorithm(a); setOutcome(null); }} support={support} />
            <Button
              size="sm"
              className="h-ctl text-xs"
              onClick={mode === 'verify' ? handleVerify : handleSign}
              disabled={busy || (mode === 'verify' && !token.trim())}
            >
              {mode === 'verify' ? m('verifySignature') : m('signToken')}
            </Button>
          </>
        )}
      </ToolToolbar>

      {mode !== 'sign' && (
        <div className="flex shrink-0 flex-col border-b border-line" style={{ height: '150px' }}>
          <PaneHeader label={m('jwtToken')} hint={quickPasteHint} action={token ? <CopyButton value={token} variant="ghost" size="sm" className="h-ctl text-[11px]" /> : undefined} />
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
              <LabelledInput label={m('expectedIssuer')} value={issuer} onChange={setIssuer} placeholder="https://auth.example.com" />
              <LabelledInput label={m('expectedAudience')} value={audience} onChange={setAudience} placeholder="my-api" />
              <LabelledInput label={m('clockTolerance')} value={clockTolerance} onChange={setClockTolerance} placeholder="0" />
            </div>
            <VerifyResult outcome={outcome} />
            {decoded?.ok && <ClaimTable rows={decoded.claims.rows} />}
          </>
        )}

        {mode === 'sign' && (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-fg">{m('payloadClaims')}</span>
                <span className="text-[11px] text-fg-mute">{m('iatAuto')}</span>
              </div>
              <div className="flex min-h-[200px] flex-col overflow-hidden rounded-md border border-line">
                <JsonEditor value={payload} onChange={setPayload} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <LabelledInput label={m('expiresIn')} value={expiresIn} onChange={setExpiresIn} placeholder={m('expiresPlaceholder')} />
              <LabelledInput label={m('keyId')} value={kid} onChange={setKid} placeholder={m('optional')} />
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
                  <span className="text-xs font-medium text-fg">{m('publicKeyForVerifier')}</span>
                  <CopyButton value={publicKey} variant="ghost" size="sm" className="h-ctl text-[11px]" />
                </div>
                <Textarea value={publicKey} onChange={(e) => setPublicKey(e.target.value)} spellCheck={false} className="min-h-[80px] resize-y font-mono text-xs" />
              </div>
            )}
            {signError && <Callout tone="error">{signError}</Callout>}
            {algorithm === 'none' && (
              <Callout tone="warning" size="sm" title={m('unsignedToken')}>
                <code className="font-mono">alg: none</code> {m('unsignedBody')}
              </Callout>
            )}
            {signed && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-fg">{m('signedToken')}</span>
                  <span className="inline-flex items-center gap-1.5">
                    <Button variant="outline" size="sm" className="h-ctl text-[11px]" onClick={() => { setToken(signed); setMode('decode'); }}>
                      {m('openInDecode')}
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

// The kit's `Field` handles the label and `htmlFor`; this is just the input.
function LabelledInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-ctl text-xs" spellCheck={false} />
    </Field>
  );
}

type Decoded =
  | { ok: true; header: Record<string, unknown>; payload: unknown; signature: string; claims: ReturnType<typeof inspectClaims> }
  | { ok: false; error: string }
  | null;

function DecodeBody({ decoded, tokenReady }: { decoded: Decoded; tokenReady: boolean }) {
  const m = useMessages(MESSAGES);
  if (!decoded) return <EmptyHint ready={tokenReady} />;
  if (!decoded.ok) return <Callout tone="error">{decoded.error}</Callout>;

  return (
    <>
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-mute">{m('header')}</div>
        <div className="flex min-h-[100px] flex-col overflow-hidden rounded-md border border-line bg-sunk">
          <CodeViewer value={JSON.stringify(decoded.header, null, 2)} language="json" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-mute">{m('payload')}</div>
        <div className="flex min-h-[180px] flex-col overflow-hidden rounded-md border border-line bg-sunk">
          <CodeViewer value={JSON.stringify(decoded.payload, null, 2)} language="json" />
        </div>
      </div>
      <ClaimTable rows={decoded.claims.rows} />
      {/* This pane doesn't verify the signature; point to the mode that does. */}
      <Callout tone="warning" size="sm" title={m('decodedNotVerified')}>
        {m('decodedBodyBefore')} <strong>{m('verify')}</strong> {m('decodedBodyAfter')}
      </Callout>
    </>
  );
}

function VerifyResult({ outcome }: { outcome: VerifyOutcome | null }) {
  const m = useMessages(MESSAGES);
  if (!outcome) {
    return (
      <Callout tone="info" size="sm" icon={false}>
        {m('verifyHintBefore')}
        <code className="mx-1 font-mono">alg</code> {m('verifyHintAfter')}
      </Callout>
    );
  }
  if (outcome.valid) {
    return <Callout tone="success" icon={BadgeCheck} title={m('signatureValid')}>{outcome.message}</Callout>;
  }
  // "Expired" and "wrong audience" mean the signature itself held — a red
  // "invalid" on those reads as "forged", which is a different problem with a
  // different fix.
  const tone = outcome.code === 'expired' || outcome.code === 'nbf' || outcome.code === 'claim' ? 'warning' : 'error';
  const title = outcome.code === 'expired' ? m('expired')
    : outcome.code === 'nbf' ? m('notValidYet')
      : outcome.code === 'claim' ? m('claimFailed')
        : outcome.code === 'alg' ? m('algMismatch')
          : outcome.code === 'key' ? m('keyProblem')
            : m('signatureInvalid');
  return <Callout tone={tone} icon={AlertTriangle} title={title}>{outcome.message}</Callout>;
}
