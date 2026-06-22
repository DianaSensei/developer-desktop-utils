import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Copy, RefreshCw } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { v4 as uuidv4 } from 'uuid';

export function UuidGenerator() {
  const [uuids, setUuids] = useState<string[]>([uuidv4()]);
  const [count, setCount] = useState(1);

  const generateUuids = () => {
    const newUuids = Array.from({ length: Math.min(count, 100) }, () => uuidv4());
    setUuids(newUuids);
  };

  const copyAll = () => {
    copyToClipboard(uuids.join('\n'));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>UUID Generator</CardTitle>
        <CardDescription>Generate random UUIDs (v4)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <div className="flex-1 space-y-2">
            <Label>Number of UUIDs (max 100)</Label>
            <Input
              type="number"
              min="1"
              max="100"
              value={count}
              onChange={(e) => setCount(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={generateUuids}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Generate
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Generated UUIDs</Label>
            {uuids.length > 1 && (
              <Button onClick={copyAll} size="sm" variant="ghost">
                <Copy className="h-4 w-4 mr-2" />
                Copy All
              </Button>
            )}
          </div>
          <div className="space-y-2 max-h-[400px] overflow-y-auto border rounded-lg p-4">
            {uuids.map((uuid, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 hover:bg-accent rounded-lg">
                <span className="flex-1 font-mono text-sm">{uuid}</span>
                <Button onClick={() => copyToClipboard(uuid)} size="sm" variant="ghost">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
