import { QrCode } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'qrcode',
  label: "QR Code",
  icon: QrCode,
  description:
    "Generate QR codes from text or URLs, or decode a QR image back to its content.",
  keywords: ["qr", "qr code", "barcode", "scan", "decode", "generate", "url"],
  route: '/qrcode',
  order: 200,
  defaultEnabled: true,
  permissions: ['storage', 'clipboard:read', 'clipboard:write', 'native'],
  commands: ['read_file_data_url'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/QRCodeTool').then((m) => m.QRCodeTool),
});
