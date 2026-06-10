import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import QRCode from 'qrcode';

export function QRCodeTool() {
  const [text, setText] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [error, setError] = useState('');

  const generateQRCode = async () => {
    if (!text.trim()) {
      setError('Please enter text to encode');
      return;
    }

    try {
      const url = await QRCode.toDataURL(text, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });
      setQrCodeUrl(url);
      setError('');
    } catch (err) {
      setError('Failed to generate QR code');
      setQrCodeUrl('');
    }
  };

  const downloadQRCode = () => {
    if (!qrCodeUrl) return;

    const link = document.createElement('a');
    link.href = qrCodeUrl;
    link.download = 'qrcode.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>QR Code Generator</CardTitle>
          <CardDescription>Generate QR codes from text or URLs</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Text or URL</Label>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter text or URL to encode"
              onKeyDown={(e) => e.key === 'Enter' && generateQRCode()}
            />
          </div>

          <Button onClick={generateQRCode} className="w-full">
            Generate QR Code
          </Button>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <p className="text-sm text-red-900 dark:text-red-300">{error}</p>
            </div>
          )}

          {qrCodeUrl && (
            <div className="space-y-4">
              <div className="flex justify-center p-4 bg-white rounded-lg">
                <img src={qrCodeUrl} alt="QR Code" className="max-w-full" />
              </div>
              <Button onClick={downloadQRCode} variant="outline" className="w-full">
                Download QR Code
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
