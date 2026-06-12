import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Copy, Hash } from 'lucide-react';
import CryptoJS from 'crypto-js';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useQuickPaste } from '@/hooks/useQuickPaste';
import { useInputHistory } from '@/hooks/useInputHistory';
import { copyToClipboard } from '@/lib/clipboard';

type AesMode = 'encrypt' | 'decrypt';

export function HashTool() {
  const [input, setInput] = usePersistentState('devtool:hash:input', '');
  const [encryptKey, setEncryptKey] = usePersistentState('devtool:hash:key', '');
  const [aesMode, setAesMode] = usePersistentState<AesMode>('devtool:hash:aesMode', 'encrypt');

  useQuickPaste(setInput);
  useInputHistory(input, setInput);

  const hashes = useMemo(() => {
    if (!input) return { md5: '', sha1: '', sha256: '', sha512: '' };
    return {
      md5: CryptoJS.MD5(input).toString(),
      sha1: CryptoJS.SHA1(input).toString(),
      sha256: CryptoJS.SHA256(input).toString(),
      sha512: CryptoJS.SHA512(input).toString(),
    };
  }, [input]);

  const aesResult = useMemo(() => {
    if (!input || !encryptKey) return '';
    try {
      if (aesMode === 'encrypt') {
        return CryptoJS.AES.encrypt(input, encryptKey).toString();
      } else {
        const bytes = CryptoJS.AES.decrypt(input, encryptKey);
        const result = bytes.toString(CryptoJS.enc.Utf8);
        return result || 'Error: Invalid key or encrypted text';
      }
    } catch {
      return 'Error: Decryption failed';
    }
  }, [input, encryptKey, aesMode]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hash className="h-5 w-5" />
            Hash Generator
          </CardTitle>
          <CardDescription>Generate MD5, SHA-1, SHA-256, SHA-512 hashes from text</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Input Text</Label>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter text to hash — Press ⌘V to paste"
              className="min-h-[100px]"
            />
          </div>

          <div className="space-y-3">
            {([
              { label: 'MD5', value: hashes.md5 },
              { label: 'SHA-1', value: hashes.sha1 },
              { label: 'SHA-256', value: hashes.sha256 },
              { label: 'SHA-512', value: hashes.sha512 },
            ] as const).map(({ label, value }) => (
              <div key={label} className="space-y-1">
                <Label className="text-xs text-muted-foreground">{label}</Label>
                <div className="flex gap-2">
                  <Input value={value} readOnly className="font-mono text-xs" />
                  <Button onClick={() => copyToClipboard(value)} size="icon" variant="outline" disabled={!value}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AES Encryption / Decryption</CardTitle>
          <CardDescription>Encrypt or decrypt text using AES</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Encryption Key</Label>
            <Input
              type="password"
              value={encryptKey}
              onChange={(e) => setEncryptKey(e.target.value)}
              placeholder="Enter encryption key"
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant={aesMode === 'encrypt' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => setAesMode('encrypt')}
            >
              Encrypt
            </Button>
            <Button
              variant={aesMode === 'decrypt' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => setAesMode('decrypt')}
            >
              Decrypt
            </Button>
          </div>

          {aesResult && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{aesMode === 'encrypt' ? 'Encrypted' : 'Decrypted'}</Label>
                <Button onClick={() => copyToClipboard(aesResult)} size="sm" variant="ghost">
                  <Copy className="h-4 w-4 mr-2" />
                  Copy
                </Button>
              </div>
              <Textarea value={aesResult} readOnly className="min-h-[80px] font-mono text-xs" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
