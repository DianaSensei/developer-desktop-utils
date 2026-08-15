import { useMemo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { PaneHeader } from '@/components/ui/tool-layout';
import { CodeViewer } from '@/design-system';
import { Callout } from '@/components/ui/callout';
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
          <Callout tone="error">{decoded.error}</Callout>
        ) : decoded.header ? (
          <>
            {/* Header và Payload từng được phân biệt bằng MÀU KHUNG — accent cho
                Header, tím cho Payload. Hai vấn đề: accent đổi theo tone chủ đạo
                nên chỉ một trong hai khung đổi màu khi swap tone, và bản thân màu
                không nói gì mà nhãn chưa nói. Giờ cả hai dùng cùng một khung
                trung tính; nhãn chữ mang toàn bộ sự phân biệt. */}
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Header</div>
              <div className="flex min-h-[100px] flex-col overflow-hidden rounded-md border border-border bg-sunk">
                <CodeViewer value={decoded.header} language="json" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Payload</div>
              <div className="flex min-h-[180px] flex-col overflow-hidden rounded-md border border-border bg-sunk">
                <CodeViewer value={decoded.payload} language="json" />
              </div>
            </div>
            {/* Cảnh báo thật (không xác thực chữ ký) — dùng Callout thay vì tự
                dựng khung amber lần thứ 8 trong repo. */}
            <Callout tone="warning" size="sm" title="Decode only">
              This tool does not verify the signature.
            </Callout>
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
