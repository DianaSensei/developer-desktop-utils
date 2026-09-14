import { Pipette } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'color-picker',
  label: "Color Picker",
  icon: Pipette,
  description:
    "Pick colors from an image and convert between HEX, RGB, HSL, and CMYK.",
  keywords: ["hex", "rgb", "hsl", "cmyk", "eyedropper", "palette", "swatch", "image", "colour"],
  route: '/color-picker',
  order: 210,
  defaultEnabled: false,
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/ColorPicker').then((m) => m.ColorPicker),
});
