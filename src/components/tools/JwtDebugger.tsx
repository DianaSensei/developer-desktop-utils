import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Shield } from 'lucide-react';
import { jwtDecode } from 'jwt-decode';
import { usePersistentState } from '@/hooks/usePersistentState';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';

export function JwtDebugger() {
  const [token, setToken] = usePersistentState('devtool:jwt:token', '');

  useQuickPaste(setToken);
  useInputHistory(token, setToken);

  const decoded = useMemo(() => {
    if (!token.trim()) return { header: '', payload: '', error: '' };
    try {
      const parts = token.split('.');
      const headerDecoded = JSON.parse(atob(parts[0]));
      const payloadDecoded = jwtDecode(token, { header: false });
      return {
        header: JSON.stringify(headerDecoded, null, 2),
        payload: JSON.stringify(payloadDecoded, null, 2),
        error: '',
      };
    } catch (err) {
      return { header: '', payload: '', error: err instanceof Error ? err.message : 'Invalid JWT token' };
    }
  }, [token]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          JWT Debugger
        </CardTitle>
        <CardDescription>Decode and inspect JWT tokens</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>JWT Token</Label>
          <Textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... — ${quickPasteHint}`}
            className="min-h-[120px] font-mono text-sm"
          />
        </div>

        {decoded.error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <p className="text-sm text-red-900 dark:text-red-300">{decoded.error}</p>
          </div>
        )}

        {!decoded.error && decoded.header && (
          <>
            <div className="space-y-2">
              <Label className="text-blue-600 dark:text-blue-400">Header</Label>
              <Textarea
                value={decoded.header}
                readOnly
                className="min-h-[120px] font-mono text-sm bg-blue-50 dark:bg-blue-950/20"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-purple-600 dark:text-purple-400">Payload</Label>
              <Textarea
                value={decoded.payload}
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
