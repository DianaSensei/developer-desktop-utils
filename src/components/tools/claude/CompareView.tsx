import { useMemo, useState } from 'react';
import { Badge, Callout, DataTable, Segmented, StatusDot, Tbody, Td, Th, Thead, Tr, cn } from '@/design-system';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from './ClaudeManager.messages';
import { QuotaPanel, type useApiQuota } from './QuotaPanel';
import {
  SHARED_ACCOUNT, compareAccounts, latestQuota, quotaPressure, roomiestAccount, formatCost, formatTokens, leastUsedAccount, shortModel,
  type AccountComparison, type ComparePeriod, type Profile, type ProfileSnapshot, type SessionRow, type UsageTotals,
} from './usage';

type M = ReturnType<typeof useMessages<typeof MESSAGES>>;
type Metric = 'tokens' | 'cost';

const PERIODS: Array<[ComparePeriod, 'period5h' | 'periodToday' | 'period7d' | 'period30d']> = [
  ['fiveHours', 'period5h'], ['today', 'periodToday'], ['week', 'period7d'], ['month', 'period30d'],
];

function timeAgo(m: M, at: number | null, now: number): string {
  if (at === null) return m('neverUsed');
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return m('justNow');
  if (minutes < 60) return m('minutesAgo', { n: minutes });
  if (minutes < 60 * 24) return m('hoursAgo', { n: Math.floor(minutes / 60) });
  return m('daysAgo', { n: Math.floor(minutes / (60 * 24)) });
}

/** Seven days of cost as bars sharing one scale across every account. */
function DailyBars({ values, max, label }: { values: number[]; max: number; label: string }) {
  return (
    // Not a control: 32px chart height set inline, outside the control-height scale.
    <div className="flex w-28 items-end gap-0.5" style={{ height: 32 }} role="img" aria-label={label}>
      {values.map((v, i) => (
        <div
          // Fixed order of the last seven days.
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          title={formatCost(v)}
          className="min-w-0 flex-1 rounded-t-xs bg-acc"
          style={{ height: v > 0 ? `${Math.max(8, (v / max) * 100)}%` : '2px', opacity: v > 0 ? 1 : 0.25 }}
        />
      ))}
    </div>
  );
}

/** A value with a bar showing its share of the largest value in the row. */
function MetricCell({ totals, metric, max, highlight }: { totals: UsageTotals; metric: Metric; max: number; highlight: boolean }) {
  const value = metric === 'tokens' ? totals.tokens : totals.cost;
  return (
    <Td numeric className={cn(highlight && 'bg-ok-tint/40')}>
      <div className="tabular-nums">{metric === 'tokens' ? formatTokens(value) : formatCost(value)}</div>
      <div className="ml-auto mt-1 h-1 w-full max-w-[7rem] overflow-hidden rounded-full bg-bg-2">
        <div className="h-full rounded-full bg-acc transition-[width]" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
      </div>
    </Td>
  );
}

interface CompareViewProps {
  rows: SessionRow[];
  profiles: Profile[];
  snapshots: ProfileSnapshot[] | null;
  now: number;
  api: ReturnType<typeof useApiQuota>;
  onSetApi: (profile: Profile, on: boolean) => void;
  onHookChanged: () => void;
}

/**
 * Every account side by side — the same periods for each, one column per
 * account — so picking the account to work in next is one look.
 */
export function CompareView({ rows, profiles, snapshots, now, api, onSetApi, onHookChanged }: CompareViewProps) {
  const m = useMessages(MESSAGES);
  const [metric, setMetric] = useState<Metric>('tokens');
  const columns = useMemo(() => compareAccounts(rows, profiles, now), [rows, profiles, now]);
  const usable = profiles.filter((_, i) => snapshots?.[i]?.exists).map((p) => p.id);
  // Real plan usage beats local token counts when there is enough of it.
  const readings = profiles.map((p, i) =>
    [p.id, latestQuota(snapshots?.[i]?.statuslineQuota, p.quotaApi ? api.states[p.id]?.reading : null)] as [string, ReturnType<typeof latestQuota>]);
  const byQuota = roomiestAccount(readings.filter(([id]) => usable.includes(id)), now);
  const suggested = byQuota ?? leastUsedAccount(columns, usable);
  const labelOf = (key: string) => (key === SHARED_ACCOUNT ? m('sharedAccount') : profiles.find((p) => p.id === key)?.label ?? key);
  const snapOf = (key: string) => snapshots?.[profiles.findIndex((p) => p.id === key)];
  const valueOf = (c: AccountComparison, period: ComparePeriod) =>
    metric === 'tokens' ? c.periods[period].tokens : c.periods[period].cost;
  const maxDaily = Math.max(0, ...columns.flatMap((c) => c.dailyCost));
  const hasShared = columns.some((c) => c.key === SHARED_ACCOUNT);

  const quotaOfSuggested = byQuota && readings.find(([id]) => id === byQuota)?.[1];
  const pressure = quotaOfSuggested ? quotaPressure(quotaOfSuggested, now) : null;

  return (
    <>
      <QuotaPanel
        profiles={profiles}
        snapshots={snapshots}
        api={api}
        suggested={byQuota}
        now={now}
        onSetApi={onSetApi}
        onHookChanged={onHookChanged}
      />
      {byQuota && pressure !== null && (
        <Callout tone="success" size="sm">
          {m('quotaSuggestion', { label: labelOf(byQuota), percent: Math.round(pressure) })}
        </Callout>
      )}
      <Callout tone="info" size="sm">{m('quotaNote')}</Callout>
      {profiles.length < 2 ? <Callout tone="info">{m('compareNeedsTwo')}</Callout> : (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-[11px] text-fg-mute">{m('compareIntro')}</p>
        <Segmented
          size="sm"
          value={metric}
          onValueChange={setMetric}
          aria-label={m('chartMetric')}
          options={[{ value: 'tokens', label: m('colTokens') }, { value: 'cost', label: m('colCost') }]}
        />
      </div>

      {suggested && !byQuota && (
        <Callout tone="success" size="sm">
          {m('compareSuggestion', { label: labelOf(suggested) })}
        </Callout>
      )}

      <DataTable>
        <Thead>
          <Tr>
            <Th className="w-40" />
            {columns.map((c) => (
              <Th key={c.key} align="right" className={cn(c.key === suggested && 'bg-ok-tint/40')}>
                <div className="truncate normal-case text-fg" title={labelOf(c.key)}>{labelOf(c.key)}</div>
                {c.key === suggested && <Badge tone="success" size="xs" className="mt-1">{m('leastUsed')}</Badge>}
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          <Tr>
            <Td className="text-fg-mute">{m('colSignedIn')}</Td>
            {columns.map((c) => {
              const snap = snapOf(c.key);
              return (
                <Td key={c.key} align="right" className="max-w-[12rem] truncate text-xs" title={snap?.account?.email ?? undefined}>
                  {c.key === SHARED_ACCOUNT ? '—' : !snap?.exists ? <Badge tone="danger">{m('dirMissing')}</Badge>
                    : snap.account?.email ?? <span className="text-fg-mute">{m('notSignedIn')}</span>}
                </Td>
              );
            })}
          </Tr>
          <Tr>
            <Td className="text-fg-mute">{m('compareRunning')}</Td>
            {columns.map((c) => (
              <Td key={c.key} numeric>
                <span className="inline-flex items-center gap-1.5">
                  {c.running > 0 && <StatusDot tone="live" pulse />}
                  {c.running}
                </span>
              </Td>
            ))}
          </Tr>
          <Tr>
            <Td className="text-fg-mute">{m('colActivity')}</Td>
            {columns.map((c) => <Td key={c.key} align="right" className="whitespace-nowrap text-xs">{timeAgo(m, c.lastActiveAt, now)}</Td>)}
          </Tr>
          {PERIODS.map(([period, label]) => {
            const max = Math.max(0, ...columns.map((c) => valueOf(c, period)));
            return (
              <Tr key={period}>
                <Td className="font-medium">{m(label)}</Td>
                {columns.map((c) => (
                  <MetricCell key={c.key} totals={c.periods[period]} metric={metric} max={max} highlight={c.key === suggested} />
                ))}
              </Tr>
            );
          })}
          <Tr>
            <Td className="text-fg-mute">{m('compareRequests7d')}</Td>
            {columns.map((c) => <Td key={c.key} numeric>{c.periods.week.requests.toLocaleString()}</Td>)}
          </Tr>
          <Tr>
            <Td className="text-fg-mute">{m('compareTopModel')}</Td>
            {columns.map((c) => <Td key={c.key} align="right" mono className="text-xs">{c.topModel ? shortModel(c.topModel) : '—'}</Td>)}
          </Tr>
          <Tr>
            <Td className="text-fg-mute">{m('compareDaily')}</Td>
            {columns.map((c) => (
              <Td key={c.key} align="right">
                <div className="flex justify-end">
                  <DailyBars values={c.dailyCost} max={maxDaily} label={m('compareDailyLabel', { label: labelOf(c.key) })} />
                </div>
              </Td>
            ))}
          </Tr>
        </Tbody>
      </DataTable>

      <Callout tone="info" size="sm">
        {m('compareNote')}
        {hasShared && ` ${m('compareSharedNote')}`}
      </Callout>
    </>
      )}
    </>
  );
}
