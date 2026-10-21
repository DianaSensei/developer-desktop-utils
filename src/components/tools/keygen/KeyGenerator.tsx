import { useEffect, useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { usePluginSdkFor, usePluginState } from '@/platform';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Segmented } from '@/components/ui/segmented';
import { Callout } from '@/components/ui/callout';
import { CopyButton } from '@/components/ui/copy-button';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from '@/components/tools/EncodeHashEncrypt.messages';
import {
  KEY_PRESETS, generateKey, isPresetSupported, presetById,
  type KeyPairResult, type KeyPresetId, type KeyResult, type SecretResult,
} from './keygen';

type PairView = 'pem' | 'jwk' | 'ssh' | 'wireguard';

/**
 * Key generator tab of Encode·Hash·Encrypt.
 *
 * The preset, comment and length are preferences and persist; the generated
 * keys never do — they live in component state only, so leaving the tab or
 * closing the app forgets them. Copy what you need before leaving.
 */
export function KeyGenerator() {
  const t = useMessages(MESSAGES);
  const sdk = usePluginSdkFor('base64');
  const [presetId, setPresetId] = usePluginState<KeyPresetId>(sdk, 'keygen:preset', 'ed25519');
  const [comment, setComment] = usePluginState(sdk, 'keygen:comment', '');
  const [length, setLength] = usePluginState(sdk, 'keygen:length', '32');
  const [result, setResult] = useState<KeyResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState<Record<string, boolean>>({});

  const preset = presetById(presetId) ?? KEY_PRESETS[0];

  useEffect(() => {
    let cancelled = false;
    void Promise.all(KEY_PRESETS.map(async (p) => [p.id, await isPresetSupported(p.id)] as const)).then((rows) => {
      if (!cancelled) setSupported(Object.fromEntries(rows));
    });
    return () => { cancelled = true; };
  }, []);

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await generateKey(preset.id, { comment, bytes: Number(length) }));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const groups = [
    { label: t('keygen.pairs'), presets: KEY_PRESETS.filter((p) => p.kind === 'pair') },
    { label: t('keygen.secrets'), presets: KEY_PRESETS.filter((p) => p.kind === 'secret') },
  ];

  return (
    <div className="tool-scrollable tool-padding tool-spacer">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-fg-mute">{t('keygen.type')}</p>
          <Select value={preset.id} onValueChange={(v) => { setPresetId(v as KeyPresetId); setResult(null); setError(''); }}>
            <SelectTrigger className="h-ctl w-52 text-xs rounded-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <div key={g.label}>
                  <div className="px-2 pt-2 pb-1 text-[11px] font-semibold text-fg-mute uppercase tracking-wide">{g.label}</div>
                  {g.presets.map((p) => (
                    <SelectItem key={p.id} value={p.id} disabled={supported[p.id] === false}>
                      {p.label}{supported[p.id] === false ? ` — ${t('keygen.unsupported')}` : ''}
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
        </div>
        {preset.ssh && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-fg-mute">{t('keygen.comment')}</p>
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="user@host" className="h-ctl w-44 text-xs font-mono" spellCheck={false} />
          </div>
        )}
        {preset.id === 'random' && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-fg-mute">{t('keygen.length')}</p>
            <Input value={length} onChange={(e) => setLength(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="h-ctl w-24 text-xs font-mono" />
          </div>
        )}
        <Button size="sm" className="h-ctl gap-1.5 text-xs" onClick={generate} disabled={busy || supported[preset.id] === false}>
          {busy ? <Spinner size="xs" /> : result ? <RefreshCw className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />}
          {result ? t('keygen.regenerate') : t('keygen.generate')}
        </Button>
      </div>
      <p className="text-[11px] text-fg-mute">{t(`keygen.uses.${preset.id}`)}</p>

      {error && <Callout tone="error" size="sm">{error}</Callout>}

      {result?.kind === 'pair' && <PairOutput result={result} />}
      {result?.kind === 'secret' && <SecretOutput result={result} />}

      {result && (
        <p className="text-[11px] text-fg-mute">{t('keygen.notSaved')}</p>
      )}
    </div>
  );
}

function OutputBlock({ label, value, rows = 4, hint }: { label: string; value: string; rows?: number; hint?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        <CopyButton value={value} variant="ghost" size="sm" className="h-auto px-2 py-1 text-xs text-fg-mute" iconClassName="h-3 w-3" />
      </div>
      <Textarea readOnly value={value} rows={rows} className="font-mono text-[11px] leading-relaxed resize-y" spellCheck={false} />
      {hint && <p className="text-[11px] text-fg-mute">{hint}</p>}
    </div>
  );
}

function PairOutput({ result }: { result: KeyPairResult }) {
  const t = useMessages(MESSAGES);
  const views: PairView[] = ['pem', 'jwk', ...(result.ssh ? ['ssh' as const] : []), ...(result.wireguard ? ['wireguard' as const] : [])];
  const [view, setView] = useState<PairView>(result.ssh ? 'ssh' : 'pem');
  const current = views.includes(view) ? view : views[0];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={current}
          onValueChange={setView}
          size="sm"
          options={views.map((v) => ({ value: v, label: t(`keygen.view.${v}`) }))}
          aria-label={t('keygen.format')}
        />
        <span className="text-[11px] text-fg-mute font-mono truncate" title="kid">
          {current === 'ssh' && result.ssh ? result.ssh.fingerprint : `kid ${result.kid}`}
        </span>
      </div>

      {current === 'pem' && (
        <div className={cn('grid gap-3 md:grid-cols-2')}>
          <OutputBlock label={t('keygen.privateKey')} value={result.privatePem} rows={8} hint="PKCS#8" />
          <OutputBlock label={t('keygen.publicKey')} value={result.publicPem} rows={8} hint="SPKI / X.509 SubjectPublicKeyInfo" />
        </div>
      )}
      {current === 'jwk' && (
        <div className="grid gap-3 md:grid-cols-2">
          <OutputBlock label={t('keygen.privateJwk')} value={JSON.stringify(result.privateJwk, null, 2)} rows={10} />
          <OutputBlock label={t('keygen.jwks')} value={result.jwks} rows={10} hint={t('keygen.jwksHint')} />
        </div>
      )}
      {current === 'ssh' && result.ssh && (
        <div className="space-y-3">
          <OutputBlock label={t('keygen.sshPublic')} value={result.ssh.publicKey} rows={3} hint={t('keygen.sshPublicHint')} />
          <OutputBlock label={t('keygen.sshPrivate')} value={result.ssh.privateKey} rows={8} hint={t('keygen.sshPrivateHint')} />
        </div>
      )}
      {current === 'wireguard' && result.wireguard && (
        <div className="grid gap-3 md:grid-cols-2">
          <OutputBlock label="PrivateKey" value={result.wireguard.privateKey} rows={2} hint={t('keygen.wgPrivateHint')} />
          <OutputBlock label="PublicKey" value={result.wireguard.publicKey} rows={2} hint={t('keygen.wgPublicHint')} />
        </div>
      )}
    </div>
  );
}

function SecretOutput({ result }: { result: SecretResult }) {
  const t = useMessages(MESSAGES);
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-fg-mute">{t('keygen.secretBits', { bytes: result.bytes, bits: result.bytes * 8 })}</p>
      <OutputBlock label="Base64" value={result.base64} rows={2} />
      <OutputBlock label="Base64 URL" value={result.base64url} rows={2} />
      <OutputBlock label="Hex" value={result.hex} rows={2} />
      {result.jwk && <OutputBlock label="JWK (oct)" value={JSON.stringify(result.jwk, null, 2)} rows={5} />}
    </div>
  );
}
