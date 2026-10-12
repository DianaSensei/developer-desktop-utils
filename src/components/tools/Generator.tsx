import { usePluginSdkFor, usePluginState } from '@/platform';
// Generator — unifies the two data generators behind one tool: "Random" for
// quick UUIDs / numbers / text, and "Test Data" for schema-based fake datasets.

import { Segmented } from '@/components/ui/segmented';
import { Dices, FlaskConical } from 'lucide-react';
import { RandomGenerator } from './RandomGenerator';
import { FakeDataGenerator } from './FakeDataGenerator';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from '@/components/tools/Generator.messages';
import { ToolToolbar } from '@/components/ui/tool-layout';

type Mode = 'random' | 'fake';

export function Generator() {
  const sdk = usePluginSdkFor('generator');
  const [mode, setMode] = usePluginState<Mode>(sdk, 'generator:tab', 'random', { legacyKey: 'devtool:generator:tab' });

  const m = useMessages(MESSAGES);

  return (
    <div className="flex flex-col h-full">
      <ToolToolbar className="flex items-center gap-3">
        <Segmented
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'random', label: m('random'), icon: Dices },
            { value: 'fake', label: m('testData'), icon: FlaskConical },
          ]}
          aria-label={m('typeLabel')}
        />
      </ToolToolbar>
      <div className="flex-1 min-h-0">
        {mode === 'random' ? <RandomGenerator /> : <FakeDataGenerator />}
      </div>
    </div>
  );
}
