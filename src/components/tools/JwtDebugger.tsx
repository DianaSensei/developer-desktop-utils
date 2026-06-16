import { useMemo } from 'react';
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
    <div className="flex flex-col h-full">
      {/* Token input — fixed height */}
      <div className="shrink-0 border-b flex flex-col" style={{ height: '160px' }}>
        <div className="shrink-0 px-4 py-1.5 border-b bg-muted/20 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>JWT Token</span>
          <span>{quickPasteHint}</span>
        </div>
        <Textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
          className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
        />
      </div>

      {/* Decoded output — scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {decoded.error ? (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <p className="text-sm text-red-900 dark:text-red-300">{decoded.error}</p>
          </div>
        ) : decoded.header ? (
          <>
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-blue-600 dark:text-blue-400">Header</div>
              <Textarea value={decoded.header} readOnly className="min-h-[100px] font-mono text-sm bg-blue-50 dark:bg-blue-950/20" />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-purple-600 dark:text-purple-400">Payload</div>
              <Textarea value={decoded.payload} readOnly className="min-h-[180px] font-mono text-sm bg-purple-50 dark:bg-purple-950/20" />
            </div>
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <p className="text-xs text-yellow-900 dark:text-yellow-300">
                This tool only decodes the token — it does not verify the signature.
              </p>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-3 pt-12">
            <Shield className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm">Paste a JWT token to decode it</p>
          </div>
        )}
      </div>
    </div>
  );
}
