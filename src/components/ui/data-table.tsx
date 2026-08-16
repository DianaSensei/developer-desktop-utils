// The dense read-only data grid used by every "list of things from a server"
// view: Kafka topics and consumer groups, RabbitMQ queues, exchanges, bindings,
// connections and channels, the API Client runner's data preview.
//
// All eight of those had independently arrived at nearly the same markup —
// `overflow-x-auto rounded-lg border border-border/50` wrapping a
// `w-full text-xs` table with a `bg-muted/20` header and `divide-y
// divide-border/40` rows — but with drifting cell padding (`px-3` vs `px-3.5`)
// and header tint (`bg-muted/20` vs `bg-muted/30`). These parts fix the
// geometry in one place.
//
//   <DataTable>
//     <Thead><Tr><Th>Name</Th><Th align="right">Ready</Th></Tr></Thead>
//     <Tbody>
//       {rows.map((r) => (
//         <Tr key={r.name} interactive onClick={() => open(r)}>
//           <Td mono>{r.name}</Td>
//           <Td numeric>{r.ready}</Td>
//         </Tr>
//       ))}
//     </Tbody>
//   </DataTable>
//
// This is deliberately a set of thin styled elements, not a `columns`-config
// table component: the views need per-cell content (badges, buttons, status
// dots) far more than they need automatic rendering.

import * as React from 'react';
import { cn } from '@/lib/utils';

type Align = 'left' | 'right' | 'center';

/**
 * Cell padding. `default` is the roomy list-view geometry; `compact` is for
 * tables embedded in a panel or dialog (the runner's data preview, the regex
 * match list) where a full-size row would dominate the surrounding UI.
 */
export type DataTableDensity = 'default' | 'compact';

const DENSITY_CELL: Record<DataTableDensity, { head: string; body: string }> = {
  default: { head: 'px-3.5 py-2', body: 'px-3.5 py-2.5' },
  compact: { head: 'px-3 py-2', body: 'px-3 py-1.5' },
};

// Density travels by context so callers set it once on <DataTable> instead of
// threading a prop through every <Th>/<Td>.
const DensityContext = React.createContext<DataTableDensity>('default');

const ALIGN_CLASS: Record<Align, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

export interface DataTableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** Classes for the scroll container that draws the border and radius. */
  containerClassName?: string;
  density?: DataTableDensity;
}

export function DataTable({ className, containerClassName, density = 'default', children, ...props }: DataTableProps) {
  return (
    <DensityContext.Provider value={density}>
      <div className={cn('overflow-x-auto rounded-lg border border-border/50', containerClassName)}>
        <table className={cn('w-full text-xs', className)} {...props}>
          {children}
        </table>
      </div>
    </DensityContext.Provider>
  );
}

export interface TheadProps extends React.HTMLAttributes<HTMLTableSectionElement> {
  /** Pins the header while the body scrolls. Needs a height-bounded scroll container. */
  sticky?: boolean;
}

export function Thead({ sticky, className, ...props }: TheadProps) {
  return (
    <thead
      className={cn(
        'border-b border-border/50 bg-muted/20',
        sticky && 'sticky top-0 z-10 backdrop-blur',
        className,
      )}
      {...props}
    />
  );
}

export interface TbodyProps extends React.HTMLAttributes<HTMLTableSectionElement> {
  /** Alternating row tint instead of hairline separators — easier to scan wide rows. */
  zebra?: boolean;
}

export function Tbody({ zebra, className, ...props }: TbodyProps) {
  return (
    <tbody
      className={cn(zebra ? '[&>tr:nth-child(odd)]:bg-muted/20' : 'divide-y divide-border/40', className)}
      {...props}
    />
  );
}

export interface TrProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Row opens something on click — adds the hover tint and pointer cursor. */
  interactive?: boolean;
  selected?: boolean;
}

export function Tr({ interactive, selected, className, ...props }: TrProps) {
  return (
    <tr
      className={cn(
        'transition-colors',
        interactive && 'cursor-pointer hover:bg-muted/40',
        selected && 'bg-acc/10',
        className,
      )}
      {...props}
    />
  );
}

export interface ThProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
}

export function Th({ align = 'left', className, ...props }: ThProps) {
  const density = React.useContext(DensityContext);
  return (
    <th
      className={cn(
        DENSITY_CELL[density].head,
        'font-medium text-fg-mute',
        ALIGN_CLASS[align],
        className,
      )}
      {...props}
    />
  );
}

export interface TdProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
  mono?: boolean;
  /** Right-aligns and applies `tabular-nums` so digits line up column-wise. */
  numeric?: boolean;
}

export function Td({ align, mono, numeric, className, ...props }: TdProps) {
  const density = React.useContext(DensityContext);
  return (
    <td
      className={cn(
        DENSITY_CELL[density].body,
        ALIGN_CLASS[align ?? (numeric ? 'right' : 'left')],
        numeric && 'tabular-nums',
        mono && 'font-mono',
        className,
      )}
      {...props}
    />
  );
}
