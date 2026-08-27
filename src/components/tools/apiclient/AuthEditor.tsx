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
  // `masked` fields (credentials — Bearer token, API key value, OAuth client
  // secret/password) still need {{var}} highlighting, so this can't just be
  // `type="password"` like Basic Auth's password below (InlineCodeField is a
  // CodeMirror surface, not an <input>). Blur the value instead: hidden at
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
          className="flex h-ctl items-center gap-1 rounded-md border border-sunk bg-bg px-3 focus-within:ring-2 focus-within:ring-acc/40"
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
              title={revealed ? 'Hide value' : 'Reveal value'}
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
          {types.map((a) => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}
        </SelectContent>
      </Select>

      {auth.type === 'none' && <p className="py-4 text-center text-xs text-fg-mute">This request uses no authorization.</p>}
      {auth.type === 'inherit' && <p className="py-4 text-center text-xs text-fg-mute">Inherits auth from the parent folder or collection.</p>}

      {auth.type === 'bearer' && (
        <AuthField vars={vars} masked label="Token" value={auth.token} onValue={(v) => set({ token: v })} placeholder="Token or {{var}}" />
      )}

      {(auth.type === 'basic' || auth.type === 'digest') && (
        <div className="space-y-2">
          <AuthField vars={vars} label="Username" value={auth.username} onValue={(v) => set({ username: v })} placeholder="Username or {{var}}" />
          <div className="space-y-1.5">
            <Label className="text-xs">Password</Label>
            <Input type="password" value={auth.password} onChange={(e) => set({ password: e.target.value })} className="h-ctl text-xs" placeholder="Password or {{var}}" />
          </div>
          {auth.type === 'digest' && (
            <p className="text-[11px] text-fg-mute">The server's 401 challenge is answered automatically with an MD5 Digest response.</p>
          )}
        </div>
      )}

      {auth.type === 'apikey' && (
        <div className="space-y-2">
          <AuthField vars={vars} label="Key" value={auth.apiKey.key} onValue={(v) => setApiKey({ key: v })} placeholder="X-API-Key" />
          <AuthField vars={vars} masked label="Value" value={auth.apiKey.value} onValue={(v) => setApiKey({ value: v })} placeholder="Value or {{var}}" />
          <div className="space-y-1.5">
            <Label className="text-xs">Add to</Label>
            <Select value={auth.apiKey.placement} onValueChange={(v) => setApiKey({ placement: v as ApiKeyAuth['placement'] })}>
              <SelectTrigger className="h-ctl w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="header">Header</SelectItem>
                <SelectItem value="query">Query Param</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {auth.type === 'oauth2' && (
        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Grant Type</Label>
            <Select value={auth.oauth2.grantType} onValueChange={(v) => setOAuth({ grantType: v as OAuth2Auth['grantType'] })}>
              <SelectTrigger className="h-ctl w-52 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="client_credentials">Client Credentials</SelectItem>
                <SelectItem value="password">Password</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <AuthField vars={vars} label="Access Token URL" value={auth.oauth2.tokenUrl} onValue={(v) => setOAuth({ tokenUrl: v })} placeholder="https://auth.example.com/oauth/token" />
          <AuthField vars={vars} label="Client ID" value={auth.oauth2.clientId} onValue={(v) => setOAuth({ clientId: v })} />
          <AuthField vars={vars} masked label="Client Secret" value={auth.oauth2.clientSecret} onValue={(v) => setOAuth({ clientSecret: v })} />
          <AuthField vars={vars} label="Scope" value={auth.oauth2.scope} onValue={(v) => setOAuth({ scope: v })} placeholder="read write" />
          {auth.oauth2.grantType === 'password' && (
            <>
              <AuthField vars={vars} label="Username" value={auth.oauth2.username} onValue={(v) => setOAuth({ username: v })} />
              <AuthField vars={vars} masked label="Password" value={auth.oauth2.password} onValue={(v) => setOAuth({ password: v })} />
            </>
          )}
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] text-fg-mute">
              The access token is fetched on the first send and reused until it expires, then sent as a Bearer header.
              It is held in memory only — never written to disk.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-ctl shrink-0 gap-1.5 text-[11px]"
              onClick={forgetToken}
            >
              {tokenCleared ? <Check className="h-3 w-3 text-ok" /> : <RotateCcw className="h-3 w-3" />}
              {tokenCleared ? 'Cleared' : 'Clear token'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
