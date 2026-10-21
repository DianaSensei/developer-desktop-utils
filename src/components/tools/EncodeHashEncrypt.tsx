import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePluginSdkFor, usePluginState, useSecretState } from '@/platform';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eye, EyeOff, Lock, ArrowLeftRight, Check, X, KeyRound, Code, AlertTriangle, ShieldCheck, Workflow, FileCheck, ImageIcon, Fingerprint } from 'lucide-react';
import { PipelineTab } from './PipelineTab';
import { JwtDebugger } from './jwt/JwtDebugger';
import { ChecksumTool } from './ChecksumTool';
import { ImageBase64Tool } from './ImageBase64Tool';
import { PasswordHash } from './PasswordHash';
import { ToolSection, ToolLabel, ToolHint } from '@/components/ui/tool-section';
import { Segmented } from '@/components/ui/segmented';
import { Callout } from '@/components/ui/callout';
import { ToolPanes, ToolPane, PaneHeader, ToolToolbar } from '@/components/ui/tool-layout';
import { EnvelopeFormatError, decryptAesGcm, encryptAesGcm, isAesGcmEnvelope } from '@/lib/aesGcm';
import { cn } from '@/lib/utils';
import { SectionLabel } from '@/components/ui/section-label';
import { useQuickPaste, useQuickPasteHint } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import { CopyButton } from '@/components/ui/copy-button';
import { Spinner } from '@/components/ui/spinner';
import { useMessages } from '@/contexts/LocaleContext';
import COMMON from '@/components/tools/common.messages';
import MESSAGES from '@/components/tools/EncodeHashEncrypt.messages';
import { ToggleChip } from '@/components/ui/toggle-chip';
import {
  CODECS, ALGORITHMS, HMAC_ALGORITHMS, ENCRYPT_ALGOS,
  computeHash, computeHmac, doEncrypt, doDecrypt,
  type AlgoId, type EncryptAlgo,
} from './encodeCore';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'encode' | 'image' | 'hash' | 'jwt' | 'checksum' | 'password' | 'encrypt' | 'pipeline';
const TABS: readonly Tab[] = ['encode', 'image', 'hash', 'jwt', 'checksum', 'password', 'encrypt', 'pipeline'];
type EncodeMode = 'encode' | 'decode';
type CryptoMode = 'encrypt' | 'decrypt';

// ─── Codecs, hashes, ciphers ──────────────────────────────────────────────────

// Pure logic lives in encodeCore.ts (shared with the Pipeline tab); re-exported
// so existing imports from this module keep working.
export * from './encodeCore';

// ─── Component ────────────────────────────────────────────────────────────────

export function EncodeHashEncrypt() {
  const m = useMessages(MESSAGES);
  const c = useMessages(COMMON);
  const quickPasteHint = useQuickPasteHint();
  const sdk = usePluginSdkFor('base64');
  // Top-level tab
  const [tab, setTab] = usePluginState<Tab>(sdk, 'codec:tab', 'encode', { legacyKey: 'devtool:codec:tab' });

  // `?tab=jwt` opens a tab directly: the old /jwt route and the ⌘K clipboard
  // suggestion for a copied token land here. Consumed once, then dropped
  // from the URL so a reload doesn't keep forcing it.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const wanted = new URLSearchParams(location.search).get('tab');
    if (!wanted) return;
    if ((TABS as readonly string[]).includes(wanted)) setTab(wanted as Tab);
    navigate({ pathname: location.pathname, search: '' }, { replace: true });
  }, [location.search, location.pathname, navigate, setTab]);

  // Encode tab
  const [input, setInput]           = usePluginState(sdk, 'codec:input', '', { legacyKey: 'devtool:codec:input' });
  const [algorithm, setAlgorithm]   = usePluginState(sdk, 'codec:algorithm', 'base64', { legacyKey: 'devtool:codec:algorithm' });
  const [encodeMode, setEncodeMode] = usePluginState<EncodeMode>(sdk, 'codec:mode', 'encode', { legacyKey: 'devtool:codec:mode' });

  // Hash tab
  const [hashInput, setHashInput]     = usePluginState(sdk, 'hash:hashInput', '', { legacyKey: 'devtool:hash:hashInput' });
  const [upperHex, setUpperHex]       = usePluginState(sdk, 'hash:upperHex', false, { legacyKey: 'devtool:hash:upperHex' });
  // Keys are credentials: they live in the encrypted vault, not in the
  // plain settings file (platform/secrets.ts migrates the old keys).
  const [hmacKey, setHmacKey]         = useSecretState(sdk, 'hmac-key', '');
  const [showHmacKey, setShowHmacKey] = useState(false);
  const [verifyAlgo, setVerifyAlgo]   = useState<AlgoId | null>(null);
  const [verifyValue, setVerifyValue] = useState('');

  // Encrypt tab
  // The text being encrypted is the secret itself; it belongs in the vault
  // with the key, not in the plain settings file.
  const [encryptInput, setEncryptInput] = useSecretState(sdk, 'encrypt-input', '');
  const [encryptKey, setEncryptKey]     = useSecretState(sdk, 'aes-key', '');
  const [cryptoMode, setCryptoMode]     = usePluginState<CryptoMode>(sdk, 'hash:aesMode', 'encrypt', { legacyKey: 'devtool:hash:aesMode' });
  const [encryptAlgo, setEncryptAlgo]   = usePluginState<EncryptAlgo>(sdk, 'hash:encryptAlgo', 'aes-gcm', { legacyKey: 'devtool:hash:encryptAlgo' });
  const [showKey, setShowKey]           = useState(false);

  // Hooks (always called; enabled param gates the listener)
  useQuickPaste(setInput,         tab === 'encode');
  useQuickPaste(setHashInput,     tab === 'hash');
  useQuickPaste(setEncryptInput,  tab === 'encrypt');
  // Pipeline tab manages its own quick-paste internally
  useInputHistory(input,         setInput,         tab === 'encode');
  useInputHistory(hashInput,     setHashInput,     tab === 'hash');
  useInputHistory(encryptInput,  setEncryptInput,  tab === 'encrypt');

  const deferredInput   = useDeferredValue(input);
  const deferredHash    = useDeferredValue(hashInput);
  const deferredEncrypt = useDeferredValue(encryptInput);

  // Encode computation
  const codec = useMemo(() => CODECS.find((c) => c.id === algorithm) ?? CODECS[0], [algorithm]);
  const { output: encodeOutput, error: encodeError } = useMemo(() => {
    if (!deferredInput) return { output: '', error: '' };
    try {
      const result = encodeMode === 'encode' ? codec.encode(deferredInput) : codec.decode(deferredInput);
      return { output: result, error: '' };
    } catch (err) {
      return { output: '', error: err instanceof Error ? err.message : m('conversionFailed') };
    }
  }, [deferredInput, codec, encodeMode]);

  // Hash computation — all 9 algorithms
  const hashes = useMemo((): Record<AlgoId, string> => {
    if (!deferredHash) {
      return Object.fromEntries(ALGORITHMS.map((a) => [a.id, ''])) as Record<AlgoId, string>;
    }
    return Object.fromEntries(
      ALGORITHMS.map(({ id }) => {
        const v = computeHash(id, deferredHash);
        return [id, upperHex ? v.toUpperCase() : v];
      })
    ) as Record<AlgoId, string>;
  }, [deferredHash, upperHex]);

  // HMAC computation — only algorithms with a dedicated HmacXXX function
  const hmacs = useMemo((): Record<AlgoId, string> => {
    if (!deferredHash || !hmacKey) {
      return Object.fromEntries(ALGORITHMS.map((a) => [a.id, ''])) as Record<AlgoId, string>;
    }
    const computed = Object.fromEntries(
      HMAC_ALGORITHMS.map(({ id }) => {
        const v = computeHmac(id, deferredHash, hmacKey);
        return [id, upperHex ? v.toUpperCase() : v];
      })
    );
    return Object.fromEntries(
      ALGORITHMS.map((a) => [a.id, computed[a.id] ?? ''])
    ) as Record<AlgoId, string>;
  }, [deferredHash, hmacKey, upperHex]);

  // Encrypt/decrypt computation
  const selectedEncryptAlgo = useMemo(
    () => ENCRYPT_ALGOS.find((a) => a.id === encryptAlgo) ?? ENCRYPT_ALGOS[0],
    [encryptAlgo]
  );

  // AES-GCM is async (Web Crypto) and deliberately slow (600k PBKDF2
  // rounds), so the encrypt tab resolves in state rather than `useMemo`.
  // The crypto-js modes finish on the first tick; only GCM shows busy.
  const [cryptoResult, setCryptoResult] = useState<{ output: string; error: string }>({ output: '', error: '' });
  const [cryptoBusy, setCryptoBusy] = useState(false);

  useEffect(() => {
    if (!deferredEncrypt || !encryptKey) {
      setCryptoResult({ output: '', error: '' });
      setCryptoBusy(false);
      return;
    }

    if (encryptAlgo !== 'aes-gcm') {
      try {
        if (cryptoMode === 'encrypt') {
          setCryptoResult({ output: doEncrypt(encryptAlgo, deferredEncrypt, encryptKey), error: '' });
        } else {
          const text = doDecrypt(encryptAlgo, deferredEncrypt, encryptKey);
          setCryptoResult(text
            ? { output: text, error: '' }
            : { output: '', error: m('invalidKeyOrCipher') });
        }
      } catch {
        setCryptoResult({ output: '', error: m('decryptFailedKey') });
      }
      setCryptoBusy(false);
      return;
    }

    // Every keystroke restarts the derivation; `stale` drops the answer from a
    // run the user has already typed past, so results can't arrive out of order.
    let stale = false;
    setCryptoBusy(true);
    (async () => {
      try {
        const output = cryptoMode === 'encrypt'
          ? await encryptAesGcm(deferredEncrypt, encryptKey)
          : await decryptAesGcm(deferredEncrypt, encryptKey);
        if (!stale) setCryptoResult({ output, error: '' });
      } catch (err) {
        if (stale) return;
        setCryptoResult({
          output: '',
          error: err instanceof EnvelopeFormatError
            ? err.message
            : isAesGcmEnvelope(deferredEncrypt)
              // The tag failed, and the envelope really is ours — so it is the
              // passphrase or the message, and GCM cannot tell you which.
              ? m('wrongPassphrase')
              : m('decryptFailedPass'),
        });
      } finally {
        if (!stale) setCryptoBusy(false);
      }
    })();
    return () => { stale = true; };
  }, [deferredEncrypt, encryptKey, cryptoMode, encryptAlgo]);

  // Inline hash verification
  const verifyMatch = useMemo(() => {
    if (!verifyAlgo || !verifyValue.trim() || !hashes[verifyAlgo]) return null;
    return verifyValue.trim().toLowerCase() === hashes[verifyAlgo].toLowerCase();
  }, [verifyAlgo, verifyValue, hashes]);

  const toggleVerify = (id: AlgoId) => {
    if (verifyAlgo === id) { setVerifyAlgo(null); setVerifyValue(''); }
    else { setVerifyAlgo(id); setVerifyValue(''); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="tool-full-height">

      {/* One toolbar with two rows (tabs, then the active tab's options)
          under a single background and border, instead of stacked bands. */}
      <ToolToolbar className="px-4 py-1.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <Segmented
          value={tab}
          onValueChange={setTab}
          options={[
            { value: 'encode', label: m('tab.encode'), icon: Code },
            { value: 'image', label: m('tab.image'), icon: ImageIcon },
            { value: 'hash', label: m('tab.hash'), icon: Lock },
            { value: 'jwt', label: m('tab.jwt'), icon: KeyRound },
            { value: 'checksum', label: m('tab.checksum'), icon: FileCheck },
            { value: 'password', label: m('tab.password'), icon: Fingerprint },
            { value: 'encrypt', label: m('tab.encrypt'), icon: ArrowLeftRight },
            { value: 'pipeline', label: m('tab.pipeline'), icon: Workflow },
          ]}
          aria-label={m('tabLabel')}
        />
      </div>
        {tab === 'encode' && (
          <div className="flex flex-wrap items-center gap-3">
            <Select value={algorithm} onValueChange={setAlgorithm}>
              <SelectTrigger className="h-ctl w-44 text-xs rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CODECS.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Segmented
              value={encodeMode}
              onValueChange={setEncodeMode}
              size="sm"
              options={[
                { value: 'encode', label: m('encode') },
                { value: 'decode', label: m('decode') },
              ]}
              aria-label={m('encodeModeLabel')}
            />
            <span className="text-xs text-fg-mute truncate hidden sm:block">{m(`codec.${codec.id}` as 'codec.base64')}</span>
          </div>
        )}
      </ToolToolbar>

      {/* ── Encode tab ───────────────────────────────────────────────────────── */}
      {tab === 'encode' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <ToolPanes>
            <ToolPane>
              <PaneHeader label={c('input')} hint={quickPasteHint} />
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={encodeMode === 'encode' ? m('encodePlaceholder') : m('decodePlaceholder', { codec: codec.label })}
                className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
              />
            </ToolPane>
            <ToolPane>
              <PaneHeader
                label={c('output')}
                action={<CopyButton value={encodeOutput} label={c('copy')} variant="ghost" size="sm" disabled={!encodeOutput} className="h-6 px-2 text-xs rounded-lg" iconClassName="h-3 w-3" />}
              />
              <Textarea
                value={encodeError ? `Error: ${encodeError}` : encodeOutput}
                readOnly
                placeholder={m('resultPlaceholder')}
                className={cn('flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4', encodeError && 'text-bad')}
              />
            </ToolPane>
          </ToolPanes>
        </div>
      )}

      {/* ── Hash tab ─────────────────────────────────────────────────────────── */}
      {tab === 'hash' && (
        <div className="tool-scrollable tool-padding tool-spacer">

          <Callout tone="info" size="sm" icon={Lock} title={m('oneWay')}>
            {m('oneWayBody')}
          </Callout>

          <ToolSection>
            <ToolLabel>{m('inputText')}</ToolLabel>
            <ToolHint>{quickPasteHint}</ToolHint>
            <Textarea
              value={hashInput}
              onChange={(e) => setHashInput(e.target.value)}
              placeholder={m('hashPlaceholder')}
              className="min-h-[100px] font-mono text-sm"
            />
          </ToolSection>

          {/* Results header with uppercase toggle */}
          <div className="flex items-center justify-between">
            <SectionLabel size="sm">{m('hashResults')}</SectionLabel>
            <ToggleChip
              pressed={upperHex}
              onPressedChange={setUpperHex}
              title={upperHex ? m('toLower') : m('toUpper')}
              aria-label={m('toUpper')}
              className="px-2 font-mono"
            >
              {upperHex ? 'ABC' : 'abc'}
            </ToggleChip>
          </div>

          <div className="space-y-2">
            {ALGORITHMS.map(({ id, label, bits, chars }) => {
              const value = hashes[id];
              const isVerifying = verifyAlgo === id;
              return (
                <div key={id} className="rounded-lg border border-line bg-bg-2/20 overflow-hidden">
                  <div className="flex items-center gap-3 px-3 pt-2.5 pb-1 group">
                    <div className="shrink-0 w-24">
                      <p className="text-xs font-semibold text-fg leading-none mb-0.5">{label}</p>
                      <p className="text-[11px] text-fg-mute">{m('bits', { n: bits })}</p>
                    </div>
                    <Input
                      value={value}
                      readOnly
                      className="flex-1 h-ctl font-mono text-xs border-0 bg-transparent p-0 focus-visible:ring-0 text-fg-mute"
                      placeholder={m('hexChars', { n: chars })}
                    />
                    <div className={cn(
                      'shrink-0 flex items-center gap-1 transition-opacity',
                      isVerifying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    )}>
                      <CopyButton value={value} disabled={!value} className="h-ctl w-ctl" iconClassName="h-3 w-3" />
                      <Button size="icon" variant={isVerifying ? 'secondary' : 'ghost'} disabled={!value} onClick={() => toggleVerify(id)} className="h-ctl w-ctl" title={m('verifyHash')} aria-label={m('verifyHash')} aria-pressed={isVerifying}>
                        <Check className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-[11px] text-fg-mute/60 px-3 pb-2">{m(`hash.${id}` as 'hash.md5')}</p>
                  {isVerifying && (
                    <div className="px-3 pb-3 border-t border-line-soft pt-2.5 space-y-2">
                      <p className="text-[11px] text-fg-mute font-medium">{m('verifyLabel', { algo: label })}</p>
                      <div className="flex items-center gap-2">
                        <Input
                          value={verifyValue}
                          onChange={(e) => setVerifyValue(e.target.value)}
                          placeholder={m('comparePlaceholder')}
                          className="h-ctl font-mono text-xs flex-1"
                          autoFocus
                        />
                        {verifyValue.trim() && verifyMatch !== null && (
                          <div className={cn(
                            'flex items-center gap-1 text-xs font-medium shrink-0',
                            verifyMatch ? 'text-ok' : 'text-bad'
                          )}>
                            {verifyMatch
                              ? <><Check className="h-3.5 w-3.5" /> {m('match')}</>
                              : <><X className="h-3.5 w-3.5" /> {m('noMatch')}</>
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

          {/* HMAC section (7 algorithms — SHA-3 excluded, no per-length HmacSHA3) */}
          <ToolSection>
            <div className="flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-fg-mute" />
              <ToolLabel>{m('hmacTitle')}</ToolLabel>
            </div>
            <ToolHint>{m('hmacHint')}</ToolHint>
            <div className="relative">
              <Input
                type={showHmacKey ? 'text' : 'password'}
                value={hmacKey}
                onChange={(e) => setHmacKey(e.target.value)}
                placeholder={m('hmacPlaceholder')}
                className="h-ctl text-sm pr-9 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowHmacKey((v) => !v)}
                aria-label={showHmacKey ? m('hideHmacKey') : m('showHmacKey')}
                title={showHmacKey ? m('hideHmacKey') : m('showHmacKey')}
                aria-pressed={showHmacKey}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded text-fg-mute hover:text-fg transition-colors focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
              >
                {showHmacKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {hmacKey ? (
              <div className="space-y-2">
                {HMAC_ALGORITHMS.map(({ id, label, bits, chars }) => {
                  const value = hmacs[id];
                  return (
                    <div key={id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-line bg-bg-2/20 group">
                      <div className="shrink-0 w-28">
                        <p className="text-xs font-semibold text-fg leading-none mb-0.5">HMAC-{label}</p>
                        <p className="text-[11px] text-fg-mute">{bits}-bit</p>
                      </div>
                      <Input
                        value={value}
                        readOnly
                        className="flex-1 h-ctl font-mono text-xs border-0 bg-transparent p-0 focus-visible:ring-0 text-fg-mute"
                        placeholder={m('hexChars', { n: chars })}
                      />
                      <CopyButton value={value} disabled={!value} className="h-ctl w-ctl shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" iconClassName="h-3 w-3" />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-fg-mute/50 text-center py-2">
                {m('hmacEmpty')}
              </p>
            )}
          </ToolSection>
        </div>
      )}

      {/* ── Image ↔ Base64 tab ───────────────────────────────────────────────── */}
      {tab === 'image' && (
        <div className="flex-1 min-h-0">
          <ImageBase64Tool />
        </div>
      )}

      {/* ── JWT tab (the former JWT Debugger tool) ───────────────────────────── */}
      {tab === 'jwt' && (
        <div className="flex-1 min-h-0">
          <JwtDebugger />
        </div>
      )}

      {/* ── Checksum (file hash) tab ─────────────────────────────────────────── */}
      {tab === 'checksum' && (
        <div className="flex-1 min-h-0">
          <ChecksumTool />
        </div>
      )}

      {/* ── Password (bcrypt / Argon2) tab ───────────────────────────────────── */}
      {tab === 'password' && (
        <div className="flex-1 min-h-0">
          <PasswordHash />
        </div>
      )}

      {/* ── Pipeline tab ─────────────────────────────────────────────────────── */}
      {tab === 'pipeline' && <PipelineTab active={tab === 'pipeline'} />}

      {/* ── Encrypt tab ──────────────────────────────────────────────────────── */}
      {tab === 'encrypt' && (
        <div className="tool-scrollable tool-padding tool-spacer">

          {/* Algorithm + mode row */}
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={encryptAlgo} onValueChange={(v) => setEncryptAlgo(v as EncryptAlgo)}>
              <SelectTrigger className="h-ctl w-44 text-xs rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENCRYPT_ALGOS.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="flex items-center gap-2">
                      {a.weak && <AlertTriangle className="h-3 w-3 shrink-0 text-warn" />}
                      {a.family === 'webcrypto' && <ShieldCheck className="h-3 w-3 shrink-0 text-ok" />}
                      {a.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Segmented
              value={cryptoMode}
              onValueChange={setCryptoMode}
              size="sm"
              options={[
                { value: 'encrypt', label: m('encrypt') },
                { value: 'decrypt', label: m('decrypt') },
              ]}
              aria-label={m('cryptoModeLabel')}
            />
          </div>

          {/* One banner per mode, saying the thing that actually matters about it.
              Every crypto-js mode carries the same caveat, because it is the same
              caveat: they are here so you can exchange ciphertext with a crypto-js
              caller, not because they are a good way to protect something. */}
          {selectedEncryptAlgo.family === 'webcrypto' ? (
            <Callout tone="success" size="sm" icon={ShieldCheck} title={m('authenticated')}>
              {m(`cipher.${selectedEncryptAlgo.id}` as 'cipher.aes-gcm')}
            </Callout>
          ) : (
            <Callout
              tone="warning"
              size="sm"
              icon={selectedEncryptAlgo.weak ? undefined : ArrowLeftRight}
              title={selectedEncryptAlgo.weak
                ? m('insecureInterop')
                : m('interopOnly')}
            >
              {selectedEncryptAlgo.weak && (
                <>
                  {m('ecbWarning')}{' '}
                </>
              )}
              {m('cryptojsWarningBefore')} <span className="font-mono">MD5</span>{m('cryptojsWarningMid')}{' '}
              <span className="font-medium text-fg">AES-256 GCM</span> {m('cryptojsWarningAfter')}
            </Callout>
          )}

          <ToolSection>
            <ToolLabel>{m('encryptionKey')}</ToolLabel>
            <ToolHint>{m('strongPassphrase')}</ToolHint>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={encryptKey}
                onChange={(e) => setEncryptKey(e.target.value)}
                placeholder={m('passphrasePlaceholder')}
                className="h-ctl text-sm pr-9 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? m('hidePassphrase') : m('showPassphrase')}
                title={showKey ? m('hidePassphrase') : m('showPassphrase')}
                aria-pressed={showKey}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded text-fg-mute hover:text-fg transition-colors focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </ToolSection>

          <ToolSection>
            <ToolLabel>{cryptoMode === 'encrypt' ? m('plaintext') : m('ciphertext')}</ToolLabel>
            <ToolHint>{quickPasteHint}</ToolHint>
            <Textarea
              value={encryptInput}
              onChange={(e) => setEncryptInput(e.target.value)}
              placeholder={cryptoMode === 'encrypt' ? m('encryptPlaceholder') : m('decryptPlaceholder')}
              className="min-h-[100px] font-mono text-sm"
            />
          </ToolSection>

          {(cryptoBusy || cryptoResult.output || cryptoResult.error) && (
            <ToolSection>
              <div className="flex items-center justify-between">
                <ToolLabel>{cryptoMode === 'encrypt' ? m('ciphertext') : m('plaintext')}</ToolLabel>
                {cryptoBusy
                  ? (
                    // 600k PBKDF2 rounds take a beat; say so rather than leaving
                    // the previous answer on screen looking current.
                    <span className="flex items-center gap-1.5 text-[11px] text-fg-mute">
                      <Spinner size="xs" />
                      {m('derivingKey')}
                    </span>
                  )
                  : cryptoResult.output && (
                    <CopyButton value={cryptoResult.output} label={c('copy')} variant="ghost" size="sm" className="h-6 px-2 text-xs" iconClassName="h-3 w-3" />
                  )}
              </div>
              {cryptoResult.error && !cryptoBusy ? (
                <div className="px-3 py-2.5 bg-bad/8 border border-bad/20 rounded-lg">
                  <p className="text-sm text-bad">{cryptoResult.error}</p>
                </div>
              ) : (
                <Textarea
                  value={cryptoBusy ? '' : cryptoResult.output}
                  readOnly
                  placeholder={cryptoBusy ? m('working') : undefined}
                  className="min-h-[80px] font-mono text-xs"
                />
              )}
            </ToolSection>
          )}
        </div>
      )}

    </div>
  );
}
