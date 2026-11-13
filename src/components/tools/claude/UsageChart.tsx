import { useMemo, useState } from 'react';
import { Segmented, cn } from '@/design-system';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from './ClaudeManager.messages';
import { formatCost, formatTokens, type BudgetState, type ChartSeries } from './usage';

type Metric = 'cost' | 'tokens';

const PLOT_HEIGHT = 160;
/** Share of the plot a non-zero bar always gets, so tiny days stay visible. */
const MIN_BAR_RATIO = 0.012;

/** Rounds up to 1, 2 or 5 × 10ⁿ so the axis ends on a readable number. */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

const shortDate = (key: string) => {
  const [, month, day] = key.split('-');
  return `${day}/${month}`;
};

/**
 * Usage over time: one series, so the bars use the app accent and the
 * title names it (no legend). The same numbers are in the "By day" table
 * below the chart.
 */
export function UsageChart({ series, dailyBudget }: { series: ChartSeries; dailyBudget?: BudgetState }) {
  const m = useMessages(MESSAGES);
  const [metric, setMetric] = useState<Metric>('cost');
  const [hovered, setHovered] = useState<number | null>(null);
  const { bars, granularity } = series;

  const valueOf = (i: number) => (metric === 'cost' ? bars[i].totals.cost : bars[i].totals.tokens);
  const format = metric === 'cost' ? formatCost : formatTokens;
  // The budget line only means something against daily cost bars.
  const budget = metric === 'cost' && granularity === 'day' ? dailyBudget?.limit : undefined;
  const top = useMemo(
    () => niceCeil(Math.max(budget ?? 0, ...bars.map((b) => (metric === 'cost' ? b.totals.cost : b.totals.tokens)))),
    [bars, metric, budget],
  );
  if (bars.length === 0) return null;

  const active = hovered !== null && hovered < bars.length ? bars[hovered] : null;
  const title = m(metric === 'cost'
    ? (granularity === 'day' ? 'chartCostDaily' : 'chartCostWeekly')
    : (granularity === 'day' ? 'chartTokensDaily' : 'chartTokensWeekly'));

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <Segmented
          size="sm"
          value={metric}
          onValueChange={setMetric}
          aria-label={m('chartMetric')}
          options={[{ value: 'cost', label: m('colCost') }, { value: 'tokens', label: m('colTokens') }]}
        />
      </div>

      <div className="rounded-md border border-line bg-card p-3">
        <div className="flex gap-2">
          <div className="flex w-12 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-fg-mute" style={{ height: PLOT_HEIGHT }}>
            <span>{format(top)}</span>
            <span>{format(top / 2)}</span>
            <span>{format(0)}</span>
          </div>
          <div className="relative min-w-0 flex-1" style={{ height: PLOT_HEIGHT }} onMouseLeave={() => setHovered(null)}>
            {[0, 0.5, 1].map((at) => (
              <div key={at} className="absolute inset-x-0 border-t border-line/60" style={{ top: `${at * 100}%` }} />
            ))}
            {budget !== undefined && (
              <div
                className="absolute inset-x-0 z-10 border-t border-dashed border-warn"
                style={{ top: `${(1 - budget / top) * 100}%` }}
              >
                <span className="absolute right-0 -translate-y-full bg-card px-1 text-[11px] text-fg-mute">
                  {m('chartBudgetLine', { amount: formatCost(budget) })}
                </span>
              </div>
            )}
            <div className="absolute inset-0 flex items-end gap-0.5" role="img" aria-label={title}>
              {bars.map((bar, i) => {
                const value = valueOf(i);
                const ratio = value > 0 ? Math.max(value / top, MIN_BAR_RATIO) : 0;
                return (
                  // The column, not the bar, is the hover target: a short bar
                  // would otherwise be a few pixels tall.
                  <div
                    key={bar.key}
                    className="flex h-full min-w-0 flex-1 items-end justify-center"
                    onMouseEnter={() => setHovered(i)}
                  >
                    <div
                      className={cn(
                        'w-full max-w-8 rounded-t-xs bg-acc transition-opacity',
                        hovered !== null && hovered !== i && 'opacity-50',
                      )}
                      style={{ height: `${ratio * 100}%` }}
                    />
                  </div>
                );
              })}
            </div>
            {active && hovered !== null && (
              <div
                className={cn(
                  'pointer-events-none absolute top-0 z-20 w-max rounded-md border border-line bg-bg px-2.5 py-1.5 text-xs shadow-md',
                  hovered > bars.length / 2 ? '-translate-x-full' : '',
                )}
                style={{ left: `${((hovered + (hovered > bars.length / 2 ? 0 : 1)) / bars.length) * 100}%` }}
              >
                <div className="font-medium">
                  {granularity === 'week' ? m('chartWeekOf', { date: active.key }) : active.key}
                </div>
                <div className="tabular-nums text-fg-mute">
                  {formatCost(active.totals.cost)} · {formatTokens(active.totals.tokens)} {m('colTokens').toLowerCase()}
                  {' · '}{m('statTokensSub', { requests: active.totals.requests.toLocaleString() })}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="ml-14 mt-1 flex justify-between text-[11px] tabular-nums text-fg-mute">
          <span>{shortDate(bars[0].key)}</span>
          {bars.length > 2 && <span>{shortDate(bars[Math.floor(bars.length / 2)].key)}</span>}
          {bars.length > 1 && <span>{shortDate(bars[bars.length - 1].key)}</span>}
        </div>
      </div>
    </section>
  );
}

const LEVEL_BAR = { ok: 'bg-ok', warn: 'bg-warn', over: 'bg-bad' } as const;
const LEVEL_NOTE = { ok: null, warn: 'budgetNear', over: 'budgetOver' } as const;

/** Progress of each switched-on budget. The state is always spelled out. */
export function BudgetBars({ states }: { states: BudgetState[] }) {
  const m = useMessages(MESSAGES);
  if (states.length === 0) return null;
  return (
    <div className="grid gap-2 @2xl:grid-cols-2">
      {states.map((s) => {
        const note = LEVEL_NOTE[s.level];
        return (
          <div key={s.period} className="rounded-md border border-line bg-card px-3 py-2">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium">{m(s.period === 'daily' ? 'budgetToday' : 'budgetThisMonth')}</span>
              <span className="tabular-nums text-fg-mute">
                {formatCost(s.spent)} / {formatCost(s.limit)} · {Math.round(s.ratio * 100)}%
                {note && <span className={s.level === 'over' ? ' text-bad' : ' text-warn'}> · {m(note)}</span>}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-2">
              <div
                className={cn('h-full rounded-full transition-[width]', LEVEL_BAR[s.level])}
                style={{ width: `${Math.min(1, s.ratio) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
