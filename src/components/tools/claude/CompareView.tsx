import { Callout } from '@/design-system';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from './ClaudeManager.messages';
import { QuotaPanel, type useApiQuota } from './QuotaPanel';
import { latestQuota, quotaPressure, roomiestAccount, type Profile, type ProfileSnapshot } from './usage';

interface CompareViewProps {
  profiles: Profile[];
  snapshots: ProfileSnapshot[] | null;
  now: number;
  api: ReturnType<typeof useApiQuota>;
  onSetApi: (profile: Profile, on: boolean) => void;
  onHookChanged: () => void;
}

/**
 * Plan usage of every account, side by side, most room first — and nothing
 * else: local token counts are not the plan limit and live in the Usage tab.
 */
export function CompareView({ profiles, snapshots, now, api, onSetApi, onHookChanged }: CompareViewProps) {
  const m = useMessages(MESSAGES);
  const readings = profiles
    .map((p, i) => [p.id, snapshots?.[i]?.exists
      ? latestQuota(snapshots[i].statuslineQuota, p.quotaApi ? api.states[p.id]?.reading : null)
      : null] as [string, ReturnType<typeof latestQuota>]);
  const suggested = roomiestAccount(readings, now);
  const reading = suggested ? readings.find(([id]) => id === suggested)?.[1] : null;
  const pressure = reading ? quotaPressure(reading, now) : null;
  const label = profiles.find((p) => p.id === suggested)?.label ?? '';

  return (
    <>
      {suggested && pressure !== null && (
        <Callout tone="success" size="sm">{m('quotaSuggestion', { label, percent: Math.round(pressure) })}</Callout>
      )}
      <QuotaPanel
        profiles={profiles}
        snapshots={snapshots}
        api={api}
        suggested={suggested}
        now={now}
        onSetApi={onSetApi}
        onHookChanged={onHookChanged}
      />
      <Callout tone="info" size="sm">{m('quotaNote')}</Callout>
    </>
  );
}
