import { useMemo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { PaneHeader } from '@/components/ui/tool-layout';
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
      // Both segments are base64url-encoded; jwt-decode handles base64url +
      // UTF-8 correctly, whereas raw atob() rejects '-'/'_' and mangles UTF-8.
      const headerDecoded = jwtDecode(token, { header: true });
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
      <div className="shrink-0 border-b border-border flex flex-col" style={{ height: '160px' }}>
        <PaneHeader label="JWT Token" hint={quickPasteHint} />
        <Textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
          className="flex-1 min-h-0 resize-none rounded-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm p-4"
        />
      </div>

      {/* Decoded output — scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">
        {decoded.error ? (
          <div className="p-3.5 bg-destructive/8 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{decoded.error}</p>
          </div>
        ) : decoded.header ? (
          <>
            <div className="space-y-2">
              <div className="text-xs font-semibold text-primary uppercase tracking-wider">Header</div>
              <Textarea
                value={decoded.header}
                readOnly
                className="min-h-[100px] font-mono text-sm bg-primary/[0.06] dark:bg-primary/[0.10] border-primary/20 rounded-lg focus-visible:ring-primary/20"
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">Payload</div>
              <Textarea
                value={decoded.payload}
                readOnly
                className="min-h-[180px] font-mono text-sm bg-purple-50/70 dark:bg-purple-950/20 border-purple-200/50 dark:border-purple-900/40 rounded-lg focus-visible:ring-purple-500/20"
              />
            </div>
            <div className="p-3.5 bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/40 rounded-lg">
              <p className="text-xs text-amber-800 dark:text-amber-300">
                <span className="font-semibold">Note:</span> This tool only decodes the token — it does not verify the signature.
              </p>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-3 pt-12">
            <Shield className="h-12 w-12 text-muted-foreground/25" />
            <p className="text-sm font-medium">Paste a JWT token to decode it</p>
            <p className="text-xs text-muted-foreground/70">Supports HS256, RS256, ES256 and more</p>
          </div>
        )}
      </div>
    </div>
  );
}
