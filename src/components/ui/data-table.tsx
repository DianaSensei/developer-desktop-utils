// Dense read-only data grid for "list of things from a server" views (topics,
// queues, connections, the API Client runner's data preview). Thin styled
// elements rather than a `columns`-config table, because cells often hold
// badges, buttons and status dots.
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

import * as React from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
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
  /**
   /**
    * Vertical lines between columns (default on), so values stay attached
    * to their column. Turn off for two-column label/value tables.
    */
  grid?: boolean;
}

const GridContext = React.createContext(true);

export function DataTable({ className, containerClassName, density = 'default', grid = true, children, ...props }: DataTableProps) {
  return (
    <DensityContext.Provider value={density}>
     <GridContext.Provider value={grid}>
      {/* Grids use `--r-sm`; the panel radius looks wrong around square
          cells. The border is fully opaque. */}
      <div className={cn('overflow-x-auto rounded-sm border border-line', containerClassName)}>
        <table className={cn('w-full text-xs', className)} {...props}>
          {children}
        </table>
      </div>
     </GridContext.Provider>
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
        // The header row is chrome (it sorts), with a distinct background.
        'border-b border-line bg-chrome',
        sticky && 'sticky top-0 z-10',
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
      className={cn(zebra ? '[&>tr:nth-child(odd)]:bg-bg-2/20' : 'divide-y divide-line-soft', className)}
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
        // The app's hover timing and easing, not Tailwind's default.
        'transition-colors duration-fast ease-out-soft',
        interactive && 'cursor-pointer hover:bg-bg-2/40 active:bg-bg-2/60',
        selected && 'bg-acc/10',
        className,
      )}
      {...props}
    />
  );
}

export type SortDirection = 'asc' | 'desc';

export interface ThProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
  /** Current sort direction for this column, or null/undefined when unsorted. */
  sortDirection?: SortDirection | null;
  /** Presence makes the header clickable to sort; called on click. */
  onSortClick?: () => void;
  /**
   /**
    * Second header line with the column's data type or unit (`int`,
    * `epoch ms`, `bytes`), so readers do not have to guess.
    */
  sub?: React.ReactNode;
  /** Colors `sub` by data type. */
  subTone?: 'string' | 'number' | 'bool' | 'date' | 'null' | 'binary' | 'object';
}

const SUB_TONE: Record<NonNullable<ThProps['subTone']>, string> = {
  string: 'text-type-string', number: 'text-type-number', bool: 'text-type-bool',
  date: 'text-type-date', null: 'text-type-null', binary: 'text-type-binary',
  object: 'text-type-object',
};

export function Th({ align = 'left', className, sortDirection, onSortClick, sub, subTone, children, ...props }: ThProps) {
  const density = React.useContext(DensityContext);
  const grid = React.useContext(GridContext);
  return (
    <th
      className={cn(
        DENSITY_CELL[density].head,
        grid && 'border-r border-line-soft last:border-r-0',
        'align-bottom',
        // Small caps with wide tracking so headers read as labels (as in
        // `PaneHeader`).
        'text-[11px] font-semibold uppercase tracking-wider text-fg-mute',
        ALIGN_CLASS[align],
        className,
      )}
      {...props}
    >
      {onSortClick ? (
        <button
          type="button"
          onClick={onSortClick}
          className={cn(
            'inline-flex items-center gap-1 hover:text-fg transition-colors duration-fast ease-out-soft -mx-1 px-1',
            align === 'right' && 'flex-row-reverse',
          )}
        >
          {children}
          {sortDirection === 'asc' ? (
            <ChevronUp className="h-3 w-3 shrink-0" />
          ) : sortDirection === 'desc' ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
          )}
        </button>
      ) : children}
      {sub != null && (
        <span className={cn('mt-0.5 block font-mono text-[11px] font-normal normal-case tracking-normal', subTone ? SUB_TONE[subTone] : 'text-fg-faint')}>
          {sub}
        </span>
      )}
    </th>
  );
}

export interface TdProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  align?: Align;
  mono?: boolean;
  /** Right-aligns and applies `tabular-nums` so digits line up column-wise. */
  numeric?: boolean;
  /** Colors the value by data type. */
  tone?: NonNullable<ThProps['subTone']>;
}

export function Td({ align, mono, numeric, tone, className, children, ...props }: TdProps) {
  const density = React.useContext(DensityContext);
  const grid = React.useContext(GridContext);
  // No value and an empty string look the same, so a missing value is
  // shown as an italic `NULL`. Empty strings render as before.
  const isNull = children === null || children === undefined;
  return (
    <td
      className={cn(
        DENSITY_CELL[density].body,
        grid && 'border-r border-line-soft last:border-r-0',
        ALIGN_CLASS[align ?? (numeric ? 'right' : 'left')],
        numeric && 'tabular-nums',
        mono && 'font-mono',
        tone && SUB_TONE[tone],
        className,
      )}
      {...props}
    >
      {isNull ? <span className="font-mono italic text-type-null">NULL</span> : children}
    </td>
  );
}

/**
 * Status line under a table: row count, timing, active filter, so users can
 * tell whether they see everything and whether a filter applies.
 *
 *   <DataTableStatus rows={48} shown={20} ms={8} note="filter: faction=蜀" />
 *
 * Numbers use tabular mono digits so they do not jump while updating.
 */
export interface DataTableStatusProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Total number of rows. */
  rows?: number;
  /** Rows currently shown when filtered or paged; omitted if equal to `rows`. */
  shown?: number;
  /** Time to fetch or build the data, in ms. */
  ms?: number;
  /** Right-hand note: query, active filter, source. */
  note?: React.ReactNode;
  /** Actions at the far right: paging, export. */
  actions?: React.ReactNode;
}

export function DataTableStatus({ rows, shown, ms, note, actions, className, ...props }: DataTableStatusProps) {
  const filtered = shown != null && rows != null && shown !== rows;
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-t border-line bg-chrome px-3 py-1.5 text-[11px] text-fg-mute',
        className,
      )}
      {...props}
    >
      {rows != null && (
        <span className="shrink-0 font-mono tabular-nums">
          {filtered ? <><span className="text-fg">{shown}</span>/{rows}</> : <span className="text-fg">{rows}</span>} rows
        </span>
      )}
      {ms != null && <span className="shrink-0 font-mono tabular-nums">{ms} ms</span>}
      {note != null && <span className="min-w-0 flex-1 truncate font-mono text-fg-faint">{note}</span>}
      {actions && <span className="ml-auto flex shrink-0 items-center gap-1">{actions}</span>}
    </div>
  );
}
