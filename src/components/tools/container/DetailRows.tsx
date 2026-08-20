// Small label/value building blocks shared by ContainerDetailsDialog and
// ImageDetailsDialog — both show the same shape of data (a handful of scalar
// fields, then a few key/value or tabular lists), so the layout primitives
// are factored out once instead of duplicated per dialog.

import type { ReactNode } from 'react';
import { CopyButton } from '@/components/ui/copy-button';
import { DataTable, Thead, Tbody, Tr, Th, Td } from '@/components/ui/data-table';
import { cn } from '@/lib/utils';

/** One label/value pair in the overview grid. `mono` for ids/paths/commands. */
export function DetailField({ label, value, mono, copy, className }: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  /** Full string to copy — pass when `value` is a truncated/formatted display. */
  copy?: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-[11px] text-fg-mute">{label}</p>
      {/* `div`, not `p` — some callers pass block-level content (a Badge list
          for "All tags"/"Exposed ports"), which a `<p>` can't legally contain;
          the browser would silently close the `<p>` early and corrupt the
          surrounding layout. */}
      <div className="mt-0.5 flex items-center gap-1">
        <div className={cn('text-xs break-words', mono && 'font-mono')}>{value}</div>
        {copy && <CopyButton value={copy} iconClassName="h-3 w-3" className="shrink-0" />}
      </div>
    </div>
  );
}

/** Responsive grid of DetailFields — the dialog's "Overview" section. */
export function DetailGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">{children}</div>;
}

/** Key/value table for env vars, labels, driver options — anything that's a
 *  flat string map. Splits "KEY=value" pairs (env) when given as a string[]. */
export function KeyValueTable({ entries }: { entries: [string, string][] }) {
  if (entries.length === 0) return <p className="text-xs text-fg-mute">None</p>;
  return (
    <DataTable density="compact">
      <Thead><Tr><Th>Key</Th><Th>Value</Th></Tr></Thead>
      <Tbody>
        {entries.map(([k, v]) => (
          <Tr key={k}>
            <Td mono>{k}</Td>
            <Td mono className="break-all">{v}</Td>
          </Tr>
        ))}
      </Tbody>
    </DataTable>
  );
}

export function envEntries(env: string[]): [string, string][] {
  return env.map((line) => {
    const i = line.indexOf('=');
    return i === -1 ? [line, ''] : [line.slice(0, i), line.slice(i + 1)];
  });
}

export function labelEntries(labels: Record<string, string>): [string, string][] {
  return Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
}
