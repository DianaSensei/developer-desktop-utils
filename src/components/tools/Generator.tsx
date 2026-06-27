// Generator — unifies the two data generators behind one tool: "Random" for
// quick UUIDs / numbers / text, and "Test Data" for schema-based fake datasets.

import { Segmented } from '@/components/ui/segmented';
import { Dices, FlaskConical } from 'lucide-react';
import { usePersistentState } from '@/hooks/usePersistentState';
import { RandomGenerator } from './RandomGenerator';
import { FakeDataGenerator } from './FakeDataGenerator';

type Mode = 'random' | 'fake';

export function Generator() {
  const [mode, setMode] = usePersistentState<Mode>('devtool:generator:tab', 'random');

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 header-premium px-4 py-2.5 flex items-center gap-3">
        <Segmented
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'random', label: 'Random', icon: Dices },
            { value: 'fake', label: 'Test Data', icon: FlaskConical },
          ]}
          aria-label="Generator type"
        />
      </div>
      <div className="flex-1 min-h-0">
        {mode === 'random' ? <RandomGenerator /> : <FakeDataGenerator />}
      </div>
    </div>
  );
}
