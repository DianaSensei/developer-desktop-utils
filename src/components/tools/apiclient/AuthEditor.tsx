// Auth editor shared by requests and collection/folder settings. Supports No
// Auth, Inherit, Basic, Bearer, API Key, and OAuth 2.0 (client-credentials /
// password). Tokens/values accept {{variables}}.

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { VarInput } from './VarInput';
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

export function AuthEditor({ auth, onChange, allowInherit = true, vars }: {
  auth: Auth; onChange: (a: Auth) => void; allowInherit?: boolean; vars?: VarMap;
}) {
  const set = (patch: Partial<Auth>) => onChange({ ...auth, ...patch });
  const setApiKey = (patch: Partial<ApiKeyAuth>) => set({ apiKey: { ...auth.apiKey, ...patch } });
  const setOAuth = (patch: Partial<OAuth2Auth>) => set({ oauth2: { ...auth.oauth2, ...patch } });
  const types = allowInherit ? AUTH_TYPES : AUTH_TYPES.filter((t) => t.id !== 'inherit');

  // A labelled text field that becomes {{variable}}-aware when `vars` is given.
  const Field = ({ label, value, onValue, placeholder }: {
    label: string; value: string; onValue: (v: string) => void; placeholder?: string;
  }) => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {vars ? (
        <div className="flex h-8 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring/40">
          <VarInput value={value} onChange={onValue} vars={vars} placeholder={placeholder} />
        </div>
      ) : (
        <Input className="h-8 font-mono text-xs" spellCheck={false} value={value} onChange={(e) => onValue(e.target.value)} placeholder={placeholder} />
      )}
    </div>
  );

  return (
    <div className="max-w-lg space-y-3">
      <Select value={auth.type} onValueChange={(v) => set({ type: v as AuthType })}>
        <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {types.map((a) => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}
        </SelectContent>
      </Select>

      {auth.type === 'none' && <p className="py-4 text-center text-xs text-muted-foreground">This request uses no authorization.</p>}
      {auth.type === 'inherit' && <p className="py-4 text-center text-xs text-muted-foreground">Inherits auth from the parent folder or collection.</p>}

      {auth.type === 'bearer' && (
        <Field label="Token" value={auth.token} onValue={(v) => set({ token: v })} placeholder="Token or {{var}}" />
      )}

      {(auth.type === 'basic' || auth.type === 'digest') && (
        <div className="space-y-2">
          <Field label="Username" value={auth.username} onValue={(v) => set({ username: v })} placeholder="Username or {{var}}" />
          <div className="space-y-1.5">
            <Label className="text-xs">Password</Label>
            <Input type="password" value={auth.password} onChange={(e) => set({ password: e.target.value })} className="h-8 text-xs" placeholder="Password or {{var}}" />
          </div>
          {auth.type === 'digest' && (
            <p className="text-[11px] text-muted-foreground">The server's 401 challenge is answered automatically with an MD5 Digest response.</p>
          )}
        </div>
      )}

      {auth.type === 'apikey' && (
        <div className="space-y-2">
          <Field label="Key" value={auth.apiKey.key} onValue={(v) => setApiKey({ key: v })} placeholder="X-API-Key" />
          <Field label="Value" value={auth.apiKey.value} onValue={(v) => setApiKey({ value: v })} placeholder="Value or {{var}}" />
          <div className="space-y-1.5">
            <Label className="text-xs">Add to</Label>
            <Select value={auth.apiKey.placement} onValueChange={(v) => setApiKey({ placement: v as ApiKeyAuth['placement'] })}>
              <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
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
              <SelectTrigger className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="client_credentials">Client Credentials</SelectItem>
                <SelectItem value="password">Password</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Field label="Access Token URL" value={auth.oauth2.tokenUrl} onValue={(v) => setOAuth({ tokenUrl: v })} placeholder="https://auth.example.com/oauth/token" />
          <Field label="Client ID" value={auth.oauth2.clientId} onValue={(v) => setOAuth({ clientId: v })} />
          <Field label="Client Secret" value={auth.oauth2.clientSecret} onValue={(v) => setOAuth({ clientSecret: v })} />
          <Field label="Scope" value={auth.oauth2.scope} onValue={(v) => setOAuth({ scope: v })} placeholder="read write" />
          {auth.oauth2.grantType === 'password' && (
            <>
              <Field label="Username" value={auth.oauth2.username} onValue={(v) => setOAuth({ username: v })} />
              <Field label="Password" value={auth.oauth2.password} onValue={(v) => setOAuth({ password: v })} />
            </>
          )}
          <p className="text-[11px] text-muted-foreground">The token is fetched fresh on each send and sent as a Bearer header.</p>
        </div>
      )}
    </div>
  );
}
