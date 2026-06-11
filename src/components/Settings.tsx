import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useFeatures } from '@/contexts/FeatureContext';
import {
  Calendar,
  Code,
  Hash,
  Clock,
  FileJson,
  Shield,
  Search,
  Link as LinkIcon,
  Key,
  GitCompare,
  QrCode,
  FileText,
  Filter,
  RotateCcw,
  Type,
  Palette,
} from 'lucide-react';

const FEATURE_LIST = [
  { id: 'cron-generator', label: 'Cron Generator', icon: Calendar },
  { id: 'text-transform', label: 'Text Transformer', icon: Code },
  { id: 'text-counter', label: 'Text Counter', icon: Type },
  { id: 'color-picker', label: 'Color Picker', icon: Palette },
  { id: 'base64', label: 'Encoder / Decoder', icon: Code },
  { id: 'hash', label: 'Hash & Encrypt', icon: Hash },
  { id: 'unix-time', label: 'Unix Time Converter', icon: Clock },
  { id: 'json', label: 'JSON Formatter', icon: FileJson },
  { id: 'jwt', label: 'JWT Debugger', icon: Shield },
  { id: 'regex', label: 'Regex Tester', icon: Search },
  { id: 'url', label: 'URL Encoder/Decoder', icon: LinkIcon },
  { id: 'uuid', label: 'UUID Generator', icon: Key },
  { id: 'diff', label: 'Text Diff', icon: GitCompare },
  { id: 'qrcode', label: 'QR Code Generator', icon: QrCode },
  { id: 'markdown', label: 'Markdown Preview', icon: FileText },
  { id: 'deduplicate', label: 'Array Deduplicator', icon: Filter },
];

export function Settings() {
  const { features, toggleFeature, resetToDefaults } = useFeatures();

  const enabledCount = Object.values(features).filter(Boolean).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Feature Settings</CardTitle>
              <CardDescription>
                Enable or disable tools. Disabled tools won't appear in the sidebar.
              </CardDescription>
            </div>
            <Button onClick={resetToDefaults} variant="outline" size="sm">
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset to Defaults
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-3 rounded-md border bg-muted/45 px-3 py-2">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{enabledCount}</span> of{' '}
              {FEATURE_LIST.length} features enabled
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {FEATURE_LIST.map((feature) => {
              const Icon = feature.icon;
              const isEnabled = features[feature.id] !== false;

              return (
                <div
                  key={feature.id}
                  className={`flex items-center justify-between rounded-md border px-3 py-2.5 transition-all ${
                    isEnabled
                      ? 'bg-card border-border'
                      : 'bg-muted/40 border-muted opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`h-4 w-4 ${isEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
                    <Label
                      htmlFor={feature.id}
                      className={`cursor-pointer text-sm font-medium ${
                        !isEnabled && 'text-muted-foreground'
                      }`}
                    >
                      {feature.label}
                    </Label>
                  </div>
                  <button
                    id={feature.id}
                    role="switch"
                    aria-checked={isEnabled}
                    onClick={() => toggleFeature(feature.id)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-1 ${
                      isEnabled ? 'bg-primary' : 'bg-muted-foreground/30'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        isEnabled ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About DevTool</CardTitle>
          <CardDescription>Developer utilities for daily tasks</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-3">
          <p>Version: 0.1.0</p>
          <p>Built with: Tauri, React, TypeScript, Tailwind CSS</p>
          <p>All tools run locally - your data never leaves your device</p>
        </CardContent>
      </Card>
    </div>
  );
}
