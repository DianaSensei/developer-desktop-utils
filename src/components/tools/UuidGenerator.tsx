import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { RefreshCw } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

export function UuidGenerator() {
  const [uuids, setUuids] = useState<string[]>([uuidv4()]);
  const [count, setCount] = useState(1);
  // Bumps on each generation so the list replays its reveal animation.
  const [genId, setGenId] = useState(0);

  const generateUuids = () => {
    const newUuids = Array.from({ length: Math.min(count, 100) }, () => uuidv4());
    setUuids(newUuids);
    setGenId((n) => n + 1);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 sm:p-5 space-y-4">
        <div className="flex items-end gap-2">
          <div className="space-y-1.5 flex-1 max-w-[160px]">
            <span className="text-xs font-medium text-muted-foreground">Count (max 100)</span>
            <Input
              type="number"
              min="1"
              max="100"
              value={count}
              onChange={(e) => setCount(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
              className="h-8 rounded-lg text-sm"
            />
          </div>
          <Button onClick={generateUuids} className="h-8 rounded-lg gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            Generate
          </Button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Generated UUIDs</span>
            {uuids.length > 1 && (
              <CopyButton value={() => uuids.join('\n')} label="Copy All" size="sm" variant="ghost" className="h-6 px-2 text-xs rounded-lg" iconClassName="h-3 w-3" />
            )}
          </div>
          <div key={genId} className="space-y-1.5 max-h-[400px] overflow-y-auto rounded-lg border border-border p-3 motion-safe:animate-fade-in-up">
            {uuids.map((uuid, idx) => (
              <div key={idx} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors group">
                <span className="flex-1 font-mono text-xs">{uuid}</span>
                <CopyButton
                  value={uuid}
                  variant="ghost"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity rounded-md"
                  iconClassName="h-3 w-3"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
