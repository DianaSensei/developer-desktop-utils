import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import CryptoJS from 'crypto-js';

export function HashTool() {
  const [input, setInput] = useState('');
  const [md5, setMd5] = useState('');
  const [sha1, setSha1] = useState('');
  const [sha256, setSha256] = useState('');
  const [sha512, setSha512] = useState('');

  const [encryptKey, setEncryptKey] = useState('');
  const [encrypted, setEncrypted] = useState('');
  const [decrypted, setDecrypted] = useState('');

  const generateHashes = () => {
    setMd5(CryptoJS.MD5(input).toString());
    setSha1(CryptoJS.SHA1(input).toString());
    setSha256(CryptoJS.SHA256(input).toString());
    setSha512(CryptoJS.SHA512(input).toString());
  };

  const encrypt = () => {
    if (!encryptKey) {
      setEncrypted('Error: Please provide an encryption key');
      return;
    }
    const result = CryptoJS.AES.encrypt(input, encryptKey).toString();
    setEncrypted(result);
  };

  const decrypt = () => {
    if (!encryptKey) {
      setDecrypted('Error: Please provide a decryption key');
      return;
    }
    try {
      const bytes = CryptoJS.AES.decrypt(input, encryptKey);
      const result = bytes.toString(CryptoJS.enc.Utf8);
      setDecrypted(result || 'Error: Invalid key or encrypted text');
    } catch (error) {
      setDecrypted('Error: Decryption failed');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Hash Generator</CardTitle>
          <CardDescription>Generate various hash values from text</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Input Text</Label>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter text to hash"
              className="min-h-[100px]"
            />
          </div>

          <Button onClick={generateHashes} className="w-full">
            Generate Hashes
          </Button>

          <div className="space-y-3">
            {[
              { label: 'MD5', value: md5 },
              { label: 'SHA-1', value: sha1 },
              { label: 'SHA-256', value: sha256 },
              { label: 'SHA-512', value: sha512 },
            ].map(({ label, value }) => (
              <div key={label} className="space-y-1">
                <Label className="text-xs text-muted-foreground">{label}</Label>
                <div className="flex gap-2">
                  <Input value={value} readOnly className="font-mono text-xs" />
                  <Button onClick={() => copyToClipboard(value)} size="icon" variant="outline">
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
          <CardTitle>AES Encryption/Decryption</CardTitle>
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

          <div className="grid grid-cols-2 gap-4">
            <Button onClick={encrypt}>Encrypt</Button>
            <Button onClick={decrypt} variant="outline">
              Decrypt
            </Button>
          </div>

          {encrypted && (
            <div className="space-y-2">
              <Label>Encrypted</Label>
              <div className="flex gap-2">
                <Textarea value={encrypted} readOnly className="min-h-[80px] font-mono text-xs" />
                <Button onClick={() => copyToClipboard(encrypted)} size="icon" variant="outline">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {decrypted && (
            <div className="space-y-2">
              <Label>Decrypted</Label>
              <Textarea value={decrypted} readOnly className="min-h-[80px]" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
