// Auth editor shared by requests and collection/folder settings. Supports No
// Auth, Inherit, Basic, Bearer, API Key, and OAuth 2.0 (client-credentials /
// password). Tokens/values accept {{variables}}.

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ApiKeyAuth, Auth, AuthType, OAuth2Auth } from './types';

const AUTH_TYPES: { id: AuthType; label: string }[] = [
  { id: 'none', label: 'No Auth' },
  { id: 'inherit', label: 'Inherit' },
  { id: 'basic', label: 'Basic Auth' },
  { id: 'digest', label: 'Digest Auth' },
  { id: 'bearer', label: 'Bearer Token' },
  { id: 'apikey', label: 'API Key' },
  { id: 'oauth2', label: 'OAuth 2.0' },
];

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input className="h-8 font-mono text-xs" spellCheck={false} {...props} />
    </div>
  );
}

export function AuthEditor({ auth, onChange, allowInherit = true }: { auth: Auth; onChange: (a: Auth) => void; allowInherit?: boolean }) {
  const set = (patch: Partial<Auth>) => onChange({ ...auth, ...patch });
  const setApiKey = (patch: Partial<ApiKeyAuth>) => set({ apiKey: { ...auth.apiKey, ...patch } });
  const setOAuth = (patch: Partial<OAuth2Auth>) => set({ oauth2: { ...auth.oauth2, ...patch } });
  const types = allowInherit ? AUTH_TYPES : AUTH_TYPES.filter((t) => t.id !== 'inherit');

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
        <Field label="Token" value={auth.token} onChange={(e) => set({ token: e.target.value })} placeholder="Token or {{var}}" />
      )}

      {(auth.type === 'basic' || auth.type === 'digest') && (
        <div className="space-y-2">
          <Field label="Username" value={auth.username} onChange={(e) => set({ username: e.target.value })} />
          <div className="space-y-1.5">
            <Label className="text-xs">Password</Label>
            <Input type="password" value={auth.password} onChange={(e) => set({ password: e.target.value })} className="h-8 text-xs" />
          </div>
          {auth.type === 'digest' && (
            <p className="text-[11px] text-muted-foreground">The server's 401 challenge is answered automatically with an MD5 Digest response.</p>
          )}
        </div>
      )}

      {auth.type === 'apikey' && (
        <div className="space-y-2">
          <Field label="Key" value={auth.apiKey.key} onChange={(e) => setApiKey({ key: e.target.value })} placeholder="X-API-Key" />
          <Field label="Value" value={auth.apiKey.value} onChange={(e) => setApiKey({ value: e.target.value })} placeholder="Value or {{var}}" />
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
          <Field label="Access Token URL" value={auth.oauth2.tokenUrl} onChange={(e) => setOAuth({ tokenUrl: e.target.value })} placeholder="https://auth.example.com/oauth/token" />
          <Field label="Client ID" value={auth.oauth2.clientId} onChange={(e) => setOAuth({ clientId: e.target.value })} />
          <Field label="Client Secret" value={auth.oauth2.clientSecret} onChange={(e) => setOAuth({ clientSecret: e.target.value })} />
          <Field label="Scope" value={auth.oauth2.scope} onChange={(e) => setOAuth({ scope: e.target.value })} placeholder="read write" />
          {auth.oauth2.grantType === 'password' && (
            <>
              <Field label="Username" value={auth.oauth2.username} onChange={(e) => setOAuth({ username: e.target.value })} />
              <Field label="Password" value={auth.oauth2.password} onChange={(e) => setOAuth({ password: e.target.value })} />
            </>
          )}
          <p className="text-[11px] text-muted-foreground">The token is fetched fresh on each send and sent as a Bearer header.</p>
        </div>
      )}
    </div>
  );
}
