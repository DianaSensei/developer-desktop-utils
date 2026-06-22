import { useDeferredValue, useMemo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import { ToolSection, ToolLabel, ToolHint } from '@/components/ui/tool-section';
import CryptoJS from 'crypto-js';
import { usePersistentState } from '@/hooks/usePersistentState';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import { copyToClipboard } from '@/lib/clipboard';

type AesMode = 'encrypt' | 'decrypt';

export function HashTool() {
  const [input, setInput] = usePersistentState('devtool:hash:input', '');
  const [encryptKey, setEncryptKey] = usePersistentState('devtool:hash:key', '');
  const [aesMode, setAesMode] = usePersistentState<AesMode>('devtool:hash:aesMode', 'encrypt');

  useQuickPaste(setInput);
  useInputHistory(input, setInput);

  // Four synchronous digests on every keystroke. Defer the input so the textarea
  // stays smooth while hashing a large payload; digests update at low priority.
  const deferredInput = useDeferredValue(input);
  const hashes = useMemo(() => {
    if (!deferredInput) return { md5: '', sha1: '', sha256: '', sha512: '' };
    return {
      md5: CryptoJS.MD5(deferredInput).toString(),
      sha1: CryptoJS.SHA1(deferredInput).toString(),
      sha256: CryptoJS.SHA256(deferredInput).toString(),
      sha512: CryptoJS.SHA512(deferredInput).toString(),
    };
  }, [deferredInput]);

  const aesResult = useMemo(() => {
    if (!deferredInput || !encryptKey) return '';
    try {
      if (aesMode === 'encrypt') {
        return CryptoJS.AES.encrypt(deferredInput, encryptKey).toString();
      } else {
        const bytes = CryptoJS.AES.decrypt(deferredInput, encryptKey);
        const result = bytes.toString(CryptoJS.enc.Utf8);
        return result || 'Error: Invalid key or encrypted text';
      }
    } catch {
      return 'Error: Decryption failed';
    }
  }, [deferredInput, encryptKey, aesMode]);

  return (
    <div className="tool-full-height">
      <div className="tool-scrollable tool-padding tool-spacer">
        {/* Input */}
        <ToolSection>
          <ToolLabel>Input Text</ToolLabel>
          <ToolHint>{quickPasteHint}</ToolHint>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter text to hash..."
            className="min-h-[100px] font-mono text-sm"
          />
        </ToolSection>

        {/* Hash results */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Hash Results</h3>
          <div className="space-y-2">
            {([
              { label: 'MD5', value: hashes.md5 },
              { label: 'SHA-1', value: hashes.sha1 },
              { label: 'SHA-256', value: hashes.sha256 },
              { label: 'SHA-512', value: hashes.sha512 },
            ] as const).map(({ label, value }) => (
              <div key={label} className="space-y-1">
                <ToolLabel className="text-xs">{label}</ToolLabel>
                <div className="flex gap-2">
                  <Input value={value} readOnly className="font-mono text-xs h-8" />
                  <Button onClick={() => copyToClipboard(value)} size="icon" variant="outline" disabled={!value} className="h-8 w-8 shrink-0">
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* AES section */}
        <div className="border-t pt-5 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">AES Encryption</h3>
          <ToolSection>
            <ToolLabel>Encryption Key</ToolLabel>
            <Input
              type="password"
              value={encryptKey}
              onChange={(e) => setEncryptKey(e.target.value)}
              placeholder="Enter encryption key"
              className="h-8 text-sm"
            />
          </ToolSection>
          <div className="flex gap-2">
            <Button variant={aesMode === 'encrypt' ? 'default' : 'outline'} className="flex-1 h-8 text-xs" onClick={() => setAesMode('encrypt')}>Encrypt</Button>
            <Button variant={aesMode === 'decrypt' ? 'default' : 'outline'} className="flex-1 h-8 text-xs" onClick={() => setAesMode('decrypt')}>Decrypt</Button>
          </div>
          {aesResult && (
            <ToolSection>
              <div className="flex items-center justify-between">
                <ToolLabel className="text-xs">{aesMode === 'encrypt' ? 'Encrypted' : 'Decrypted'}</ToolLabel>
                <Button onClick={() => copyToClipboard(aesResult)} size="sm" variant="ghost" className="h-6 px-2 text-xs">
                  <Copy className="h-3 w-3 mr-1" />Copy
                </Button>
              </div>
              <Textarea value={aesResult} readOnly className="min-h-[80px] font-mono text-xs" />
            </ToolSection>
          )}
        </div>
      </div>
    </div>
  );
}
