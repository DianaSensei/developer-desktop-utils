// Auth editor shared by requests and collection/folder settings. Supports No
// Auth, Inherit, Basic, Bearer, API Key, and OAuth 2.0 (client-credentials /
// password). Tokens/values accept {{variables}}.

import { useEffect, useRef, useState } from 'react';
import { Check, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { InlineCodeField } from '@/design-system';
import { clearOAuthTokenCache } from './request';
import type { ApiKeyAuth, Auth, AuthType, OAuth2Auth, VarMap } from './types';
import { t } from './i18n';

const AUTH_TYPES: { id: AuthType; label: string }[] = [
  { id: 'none', label: 'No Auth' },
  { id: 'inherit', label: 'Inherit' },
  { id: 'basic', label: 'Basic Auth' },
  { id: 'digest', label: 'Digest Auth' },
  { id: 'bearer', label: 'Bearer Token' },
  { id: 'apikey', label: 'API Key' },
  { id: 'oauth2', label: 'OAuth 2.0' },
];

// A labelled text field that becomes {{variable}}-aware when `vars` is given.
//
// Declared at module scope on purpose: when this lived inside AuthEditor a fresh
// function identity was created on every render, so React unmounted and remounted
// the subtree on each keystroke — tearing down and rebuilding the CodeMirror
// instance inside InlineCodeField and dropping the caret after every character typed.
function AuthField({ label, value, onValue, placeholder, vars, masked }: {
  label: string; value: string; onValue: (v: string) => void; placeholder?: string; vars?: VarMap; masked?: boolean;
}) {
  // Every credential here (Bearer token, Basic/Digest password, API key
  // value, OAuth client secret/password) still needs {{var}} highlighting, so
  // none of them can be a `type="password"` input — InlineCodeField is a
  // CodeMirror surface, not an <input>. Blur the value instead: hidden at
  // rest, sharp while focused (so you can see what you're editing) or with the
  // reveal toggle held open — same idea as the Vault/env-var secret rows in
  // KeyValueEditor, just via CSS since there's no per-character mask here.
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);
  const hidden = !!masked && !revealed && !focused;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {vars ? (
        <div
          className="flex h-ctl items-center gap-1 rounded-sm border border-line bg-bg px-3 focus-within:ring-[3px] focus-within:ring-focus"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          <div className={cn('min-w-0 flex-1 transition-[filter]', hidden && 'select-none blur-xs')}>
            <InlineCodeField value={value} onChange={onValue} vars={vars} placeholder={placeholder} />
          </div>
          {masked && (
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              className="shrink-0 rounded p-1 text-fg-mute/50 transition-colors hover:text-fg"
              title={revealed ? t('auth.hideValue') : t('auth.revealValue')}
              aria-label={revealed ? t('auth.hideValue') : t('auth.revealValue')}
            >
              {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      ) : (
        <Input className="h-ctl font-mono text-xs" spellCheck={false} value={value} onChange={(e) => onValue(e.target.value)} placeholder={placeholder} />
      )}
    </div>
  );
}

export function AuthEditor({ auth, onChange, allowInherit = true, vars }: {
  auth: Auth; onChange: (a: Auth) => void; allowInherit?: boolean; vars?: VarMap;
}) {
  const set = (patch: Partial<Auth>) => onChange({ ...auth, ...patch });
  const setApiKey = (patch: Partial<ApiKeyAuth>) => set({ apiKey: { ...auth.apiKey, ...patch } });
  const setOAuth = (patch: Partial<OAuth2Auth>) => set({ oauth2: { ...auth.oauth2, ...patch } });
  const types = allowInherit ? AUTH_TYPES : AUTH_TYPES.filter((t) => t.id !== 'inherit');
  const [tokenCleared, setTokenCleared] = useState(false);
  const clearedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (clearedTimer.current) clearTimeout(clearedTimer.current); }, []);

  const forgetToken = () => {
    clearOAuthTokenCache();
    setTokenCleared(true);
    if (clearedTimer.current) clearTimeout(clearedTimer.current);
    clearedTimer.current = setTimeout(() => setTokenCleared(false), 1500);
  };

  return (
    <div className="max-w-lg space-y-3">
      <Select value={auth.type} onValueChange={(v) => set({ type: v as AuthType })}>
        <SelectTrigger className="h-ctl w-48 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {types.map((a) => <SelectItem key={a.id} value={a.id}>{a.id === 'none' ? t('auth.none') : a.id === 'inherit' ? t('auth.inherit') : a.label}</SelectItem>)}
        </SelectContent>
      </Select>

      {auth.type === 'none' && <p className="py-4 text-center text-xs text-fg-mute">{t('auth.noneDesc')}</p>}
      {auth.type === 'inherit' && <p className="py-4 text-center text-xs text-fg-mute">{t('auth.inheritDesc')}</p>}

      {auth.type === 'bearer' && (
        <AuthField vars={vars} masked label={t('auth.token')} value={auth.token} onValue={(v) => set({ token: v })} placeholder={t('auth.tokenPh')} />
      )}

      {(auth.type === 'basic' || auth.type === 'digest') && (
        <div className="space-y-2">
          <AuthField vars={vars} label={t('auth.username')} value={auth.username} onValue={(v) => set({ username: v })} placeholder={t('auth.usernamePh')} />
          {/* Same masked AuthField as every other credential here, not a bare
              `type="password"` Input: the two fields sat side by side in
              different shells, and the placeholder already promised
              "{{var}}" support that a plain input can't highlight — a typo'd
              variable name looked exactly like a correct one. request.ts
              substitutes this value (see `sub(req.auth.password)`), so the
              highlighting was the only piece missing. */}
          <AuthField vars={vars} masked label={t('auth.password')} value={auth.password} onValue={(v) => set({ password: v })} placeholder={t('auth.passwordPh')} />
          {auth.type === 'digest' && (
            <p className="text-[11px] text-fg-mute">{t('auth.digestDesc')}</p>
          )}
        </div>
      )}

      {auth.type === 'apikey' && (
        <div className="space-y-2">
          <AuthField vars={vars} label={t('key')} value={auth.apiKey.key} onValue={(v) => setApiKey({ key: v })} placeholder="X-API-Key" />
          <AuthField vars={vars} masked label={t('value')} value={auth.apiKey.value} onValue={(v) => setApiKey({ value: v })} placeholder={t('auth.valuePh')} />
          <div className="space-y-1.5">
            <Label className="text-xs">{t('auth.addTo')}</Label>
            <Select value={auth.apiKey.placement} onValueChange={(v) => setApiKey({ placement: v as ApiKeyAuth['placement'] })}>
              <SelectTrigger className="h-ctl w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="header">{t('auth.header')}</SelectItem>
                <SelectItem value="query">{t('auth.queryParam')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {auth.type === 'oauth2' && (
        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label className="text-xs">{t('auth.grantType')}</Label>
            <Select value={auth.oauth2.grantType} onValueChange={(v) => setOAuth({ grantType: v as OAuth2Auth['grantType'] })}>
              <SelectTrigger className="h-ctl w-52 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="client_credentials">{t('auth.clientCredentials')}</SelectItem>
                <SelectItem value="password">{t('auth.password')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <AuthField vars={vars} label={t('auth.accessTokenUrl')} value={auth.oauth2.tokenUrl} onValue={(v) => setOAuth({ tokenUrl: v })} placeholder="https://auth.example.com/oauth/token" />
          <AuthField vars={vars} label={t('auth.clientId')} value={auth.oauth2.clientId} onValue={(v) => setOAuth({ clientId: v })} />
          <AuthField vars={vars} masked label={t('auth.clientSecret')} value={auth.oauth2.clientSecret} onValue={(v) => setOAuth({ clientSecret: v })} />
          <AuthField vars={vars} label={t('auth.scope')} value={auth.oauth2.scope} onValue={(v) => setOAuth({ scope: v })} placeholder="read write" />
          {auth.oauth2.grantType === 'password' && (
            <>
              <AuthField vars={vars} label={t('auth.username')} value={auth.oauth2.username} onValue={(v) => setOAuth({ username: v })} />
              <AuthField vars={vars} masked label={t('auth.password')} value={auth.oauth2.password} onValue={(v) => setOAuth({ password: v })} />
            </>
          )}
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] text-fg-mute">
              {t('auth.oauthDesc')}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-ctl shrink-0 gap-1.5 text-[11px]"
              onClick={forgetToken}
            >
              {tokenCleared ? <Check className="h-3 w-3 text-ok" /> : <RotateCcw className="h-3 w-3" />}
              {tokenCleared ? t('auth.cleared') : t('auth.clearToken')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
