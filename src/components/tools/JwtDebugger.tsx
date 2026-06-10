import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { jwtDecode } from 'jwt-decode';

export function JwtDebugger() {
  const [token, setToken] = useState('');
  const [header, setHeader] = useState('');
  const [payload, setPayload] = useState('');
  const [error, setError] = useState('');

  const decodeToken = (jwt: string) => {
    if (!jwt.trim()) {
      setHeader('');
      setPayload('');
      setError('');
      return;
    }

    try {
      const decoded = jwtDecode(jwt, { header: true });
      const parts = jwt.split('.');

      const headerDecoded = JSON.parse(atob(parts[0]));
      setHeader(JSON.stringify(headerDecoded, null, 2));
      setPayload(JSON.stringify(decoded, null, 2));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JWT token');
      setHeader('');
      setPayload('');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>JWT Debugger</CardTitle>
        <CardDescription>Decode and inspect JWT tokens</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>JWT Token</Label>
          <Textarea
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              decodeToken(e.target.value);
            }}
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            className="min-h-[120px] font-mono text-sm"
          />
        </div>

        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <p className="text-sm text-red-900 dark:text-red-300">{error}</p>
          </div>
        )}

        {!error && header && (
          <>
            <div className="space-y-2">
              <Label className="text-blue-600 dark:text-blue-400">Header</Label>
              <Textarea
                value={header}
                readOnly
                className="min-h-[120px] font-mono text-sm bg-blue-50 dark:bg-blue-950/20"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-purple-600 dark:text-purple-400">Payload</Label>
              <Textarea
                value={payload}
                readOnly
                className="min-h-[200px] font-mono text-sm bg-purple-50 dark:bg-purple-950/20"
              />
            </div>

            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <p className="text-xs text-yellow-900 dark:text-yellow-300">
                Note: This tool only decodes the token. It does not verify the signature.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
