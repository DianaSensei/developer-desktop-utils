import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Copy, Palette, Search } from 'lucide-react';

interface ColorFormats {
  hex: string;
  rgb: { r: number; g: number; b: number };
  cmyk: { c: number; m: number; y: number; k: number };
  hsl: { h: number; s: number; l: number };
}

// Popular Pantone colors (subset)
const PANTONE_COLORS = [
  { code: 'PANTONE 186 C', hex: '#C8102E', name: 'Red' },
  { code: 'PANTONE 293 C', hex: '#003087', name: 'Blue' },
  { code: 'PANTONE 348 C', hex: '#00843D', name: 'Green' },
  { code: 'PANTONE 116 C', hex: '#FFCD00', name: 'Yellow' },
  { code: 'PANTONE 151 C', hex: '#FF6900', name: 'Orange' },
  { code: 'PANTONE 2592 C', hex: '#A82F8D', name: 'Purple' },
  { code: 'PANTONE 485 C', hex: '#DA291C', name: 'Red' },
  { code: 'PANTONE 286 C', hex: '#0033A0', name: 'Blue' },
  { code: 'PANTONE 355 C', hex: '#009639', name: 'Green' },
  { code: 'PANTONE 109 C', hex: '#FFD700', name: 'Yellow' },
  { code: 'PANTONE Black C', hex: '#000000', name: 'Black' },
  { code: 'PANTONE Cool Gray 11 C', hex: '#53565A', name: 'Gray' },
];

export function ColorPicker() {
  const [color, setColor] = useState('#3B82F6');
  const [formats, setFormats] = useState<ColorFormats>({
    hex: '#3B82F6',
    rgb: { r: 59, g: 130, b: 246 },
    cmyk: { c: 76, m: 47, y: 0, k: 4 },
    hsl: { h: 217, s: 91, l: 60 },
  });
  const [searchTerm, setSearchTerm] = useState('');

  // Convert hex to RGB
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 0, g: 0, b: 0 };
  };

  // Convert RGB to hex
  const rgbToHex = (r: number, g: number, b: number) => {
    return '#' + [r, g, b].map((x) => {
      const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  };

  // Convert RGB to CMYK
  const rgbToCmyk = (r: number, g: number, b: number) => {
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;

    const k = 1 - Math.max(rNorm, gNorm, bNorm);
    const c = k === 1 ? 0 : (1 - rNorm - k) / (1 - k);
    const m = k === 1 ? 0 : (1 - gNorm - k) / (1 - k);
    const y = k === 1 ? 0 : (1 - bNorm - k) / (1 - k);

    return {
      c: Math.round(c * 100),
      m: Math.round(m * 100),
      y: Math.round(y * 100),
      k: Math.round(k * 100),
    };
  };

  // Convert RGB to HSL
  const rgbToHsl = (r: number, g: number, b: number) => {
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;

    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      switch (max) {
        case rNorm:
          h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6;
          break;
        case gNorm:
          h = ((bNorm - rNorm) / d + 2) / 6;
          break;
        case bNorm:
          h = ((rNorm - gNorm) / d + 4) / 6;
          break;
      }
    }

    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100),
    };
  };

  // Update all formats when color changes
  useEffect(() => {
    const rgb = hexToRgb(color);
    const cmyk = rgbToCmyk(rgb.r, rgb.g, rgb.b);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

    setFormats({
      hex: color.toUpperCase(),
      rgb,
      cmyk,
      hsl,
    });
  }, [color]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleHexChange = (hex: string) => {
    if (/^#[0-9A-F]{6}$/i.test(hex)) {
      setColor(hex);
    }
  };

  const handleRgbChange = (r: number, g: number, b: number) => {
    const hex = rgbToHex(r, g, b);
    setColor(hex);
  };

  const filteredPantone = PANTONE_COLORS.filter(
    (p) =>
      p.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Color Picker
          </CardTitle>
          <CardDescription>Pick, convert, and search colors in multiple formats</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Color Preview */}
          <div className="space-y-3">
            <Label>Color Preview</Label>
            <div className="flex gap-4 items-center">
              <div
                className="w-32 h-32 rounded-lg border-4 border-border shadow-lg"
                style={{ backgroundColor: color }}
              />
              <div className="flex-1 space-y-2">
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-20 h-12 cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    placeholder="#000000"
                    className="font-mono"
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Click the color box or enter a hex value
                </p>
              </div>
            </div>
          </div>

          {/* Color Formats */}
          <div className="grid gap-4">
            {/* HEX */}
            <div className="space-y-2">
              <Label>HEX</Label>
              <div className="flex gap-2">
                <Input
                  value={formats.hex}
                  onChange={(e) => handleHexChange(e.target.value)}
                  placeholder="#000000"
                  className="font-mono"
                />
                <Button onClick={() => copyToClipboard(formats.hex)} size="icon" variant="outline">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* RGB */}
            <div className="space-y-2">
              <Label>RGB</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="0"
                  max="255"
                  value={formats.rgb.r}
                  onChange={(e) => handleRgbChange(parseInt(e.target.value), formats.rgb.g, formats.rgb.b)}
                  placeholder="R"
                  className="font-mono"
                />
                <Input
                  type="number"
                  min="0"
                  max="255"
                  value={formats.rgb.g}
                  onChange={(e) => handleRgbChange(formats.rgb.r, parseInt(e.target.value), formats.rgb.b)}
                  placeholder="G"
                  className="font-mono"
                />
                <Input
                  type="number"
                  min="0"
                  max="255"
                  value={formats.rgb.b}
                  onChange={(e) => handleRgbChange(formats.rgb.r, formats.rgb.g, parseInt(e.target.value))}
                  placeholder="B"
                  className="font-mono"
                />
                <Button
                  onClick={() => copyToClipboard(`rgb(${formats.rgb.r}, ${formats.rgb.g}, ${formats.rgb.b})`)}
                  size="icon"
                  variant="outline"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground font-mono">
                rgb({formats.rgb.r}, {formats.rgb.g}, {formats.rgb.b})
              </p>
            </div>

            {/* CMYK */}
            <div className="space-y-2">
              <Label>CMYK</Label>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <Input value={`${formats.cmyk.c}%`} readOnly className="font-mono text-center" />
                  <p className="text-xs text-muted-foreground text-center mt-1">C</p>
                </div>
                <div>
                  <Input value={`${formats.cmyk.m}%`} readOnly className="font-mono text-center" />
                  <p className="text-xs text-muted-foreground text-center mt-1">M</p>
                </div>
                <div>
                  <Input value={`${formats.cmyk.y}%`} readOnly className="font-mono text-center" />
                  <p className="text-xs text-muted-foreground text-center mt-1">Y</p>
                </div>
                <div>
                  <Input value={`${formats.cmyk.k}%`} readOnly className="font-mono text-center" />
                  <p className="text-xs text-muted-foreground text-center mt-1">K</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  value={`cmyk(${formats.cmyk.c}%, ${formats.cmyk.m}%, ${formats.cmyk.y}%, ${formats.cmyk.k}%)`}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button
                  onClick={() =>
                    copyToClipboard(
                      `cmyk(${formats.cmyk.c}%, ${formats.cmyk.m}%, ${formats.cmyk.y}%, ${formats.cmyk.k}%)`
                    )
                  }
                  size="icon"
                  variant="outline"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* HSL */}
            <div className="space-y-2">
              <Label>HSL</Label>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Input value={`${formats.hsl.h}°`} readOnly className="font-mono text-center" />
                  <p className="text-xs text-muted-foreground text-center mt-1">Hue</p>
                </div>
                <div>
                  <Input value={`${formats.hsl.s}%`} readOnly className="font-mono text-center" />
                  <p className="text-xs text-muted-foreground text-center mt-1">Saturation</p>
                </div>
                <div>
                  <Input value={`${formats.hsl.l}%`} readOnly className="font-mono text-center" />
                  <p className="text-xs text-muted-foreground text-center mt-1">Lightness</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  value={`hsl(${formats.hsl.h}, ${formats.hsl.s}%, ${formats.hsl.l}%)`}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button
                  onClick={() =>
                    copyToClipboard(`hsl(${formats.hsl.h}, ${formats.hsl.s}%, ${formats.hsl.l}%)`)
                  }
                  size="icon"
                  variant="outline"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pantone Colors */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pantone Colors</CardTitle>
          <CardDescription>Search and select from popular Pantone colors</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search Pantone colors..."
              className="pl-9"
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto">
            {filteredPantone.map((pantone) => (
              <button
                key={pantone.code}
                onClick={() => setColor(pantone.hex)}
                className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent transition-colors text-left"
              >
                <div
                  className="w-10 h-10 rounded border-2 border-border flex-shrink-0"
                  style={{ backgroundColor: pantone.hex }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{pantone.code}</p>
                  <p className="text-xs text-muted-foreground">{pantone.hex}</p>
                </div>
              </button>
            ))}
          </div>

          {filteredPantone.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <p>No Pantone colors found</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
