// The dense read-only data grid used by every "list of things from a server"
// view: Kafka topics and consumer groups, RabbitMQ queues, exchanges, bindings,
// connections and channels, the API Client runner's data preview.
//
// All eight of those had independently arrived at nearly the same markup —
// `overflow-x-auto rounded-lg border border-line-soft` wrapping a
// `w-full text-xs` table with a `bg-bg-2/20` header and `divide-y
// divide-line-soft` rows — but with drifting cell padding (`px-3` vs `px-3.5`)
// and header tint (`bg-bg-2/20` vs `bg-bg-2/30`). These parts fix the
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
   * Đường kẻ DỌC giữa các cột. Mặc định bật.
   *
   * Chỉ kẻ ngang thì mắt đọc ra một danh sách các dòng, không đọc ra một
   * LƯỚI: sang cột thứ tư là không còn chắc giá trị này thuộc cột nào nữa,
   * nhất là khi ô trống hoặc nội dung ngắn. Mọi công cụ dữ liệu nghiêm túc
   * (DBX, DataGrip, bảng tính) đều kẻ đủ hai chiều.
   *
   * Tắt khi bảng chỉ có hai cột nhãn–giá trị, lúc đó kẻ dọc là nhiễu.
   */
  grid?: boolean;
}

const GridContext = React.createContext(true);

export function DataTable({ className, containerClassName, density = 'default', grid = true, children, ...props }: DataTableProps) {
  return (
    <DensityContext.Provider value={density}>
     <GridContext.Provider value={grid}>
      {/* `rounded-lg` (18px) là bán kính của PANEL, không phải của một lưới dữ
          liệu dày đặc: góc tròn 18px bọc quanh những ô vuông góc đọc ra lệch
          hẳn ở hàng đầu và hàng cuối. Lưới lấy `--r-sm`. Viền ở độ đục đầy —
          một cái khung hoặc có hoặc không, 50% là không quyết. */}
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
        // Hàng tiêu đề là CHROME: nó điều khiển (sắp xếp), không phải dữ liệu.
        // `bg-bg-2/20` cũ trên mặt `--card` trắng ra ≈98% — không đọc ra là
        // một hàng tiêu đề, nên mắt phải dựa vào chữ in đậm để đoán.
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
        // Nhịp chung của app, không phải mặc định của Tailwind — hai con số
        // trùng nhau (150ms) nhưng đường cong khác: `ease` phẳng của trình
        // duyệt so với `--ease-out-soft` mà mọi hover khác trong app dùng.
        // 22 view danh sách (Kafka/RabbitMQ/Redis/Container) đi qua component
        // này, nên đây là một trong những hover phổ biến nhất trong app.
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
   * Dòng thứ hai dưới tên cột: KIỂU của dữ liệu trong cột (`int`, `text`,
   * `epoch ms`, `bytes`), hoặc đơn vị.
   *
   * Đây là "công thức dòng bốn tầng" rút từ Sony Color Lab trong
   * `design/reference/ANALYSIS.md` — đã ghi vào tài liệu từ vòng thiết kế
   * trước nhưng chưa từng dùng ở đâu. Một tên cột trần bắt người đọc tự đoán
   * `1699999999` là giây hay mili-giây, `0`/`1` là số hay boolean. Ghi kiểu
   * ra là hết đoán, và tốn đúng một dòng 11px.
   */
  sub?: React.ReactNode;
  /** Tô `sub` theo hệ màu kiểu dữ liệu — liếc là biết cột nào là số/chuỗi/thời gian. */
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
        // Chữ nhỏ viết hoa giãn rộng: tiêu đề cột phải đọc ra là NHÃN, không
        // phải một dòng dữ liệu in đậm. Cùng công thức với `PaneHeader`.
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
  /** Tô giá trị theo hệ màu kiểu dữ liệu. */
  tone?: NonNullable<ThProps['subTone']>;
}

export function Td({ align, mono, numeric, tone, className, children, ...props }: TdProps) {
  const density = React.useContext(DensityContext);
  const grid = React.useContext(GridContext);
  // Một ô KHÔNG CÓ giá trị và một ô chứa chuỗi rỗng là hai chuyện khác nhau,
  // nhưng vẽ ra thì giống hệt: cả hai đều trống. Hiện `NULL` in nghiêng, màu
  // riêng của hệ kiểu dữ liệu — đây là khác biệt giữa "in dữ liệu ra màn" và
  // "mô tả dữ liệu". Chuỗi rỗng vẫn vẽ như cũ (không rơi vào nhánh này).
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
 * Thanh trạng thái dưới một bảng: bao nhiêu dòng, mất bao lâu, đang lọc gì.
 *
 * Đây là thứ DevTool thiếu ở mọi view danh sách và DBX có ở mọi lưới: dưới
 * bảng của nó luôn là `48 dòng · 8ms · SELECT * FROM … · 1000 dòng/trang`.
 * Không có dòng đó thì người dùng không biết mình đang nhìn TẤT CẢ hay chỉ
 * một phần, nhanh hay chậm, và bộ lọc có đang ăn hay không — ba câu hỏi xuất
 * hiện mỗi lần nhìn một bảng.
 *
 *   <DataTableStatus rows={48} shown={20} ms={8} note="đang lọc: faction=蜀" />
 *
 * Số liệu dùng `tabular-nums` + mono: chúng đứng thành cột khi bảng cập nhật
 * liên tục, không nhảy qua nhảy lại theo bề rộng chữ số.
 */
export interface DataTableStatusProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tổng số dòng có thật. */
  rows?: number;
  /** Số dòng đang hiện, khi đang lọc hoặc phân trang. Bỏ qua nếu bằng `rows`. */
  shown?: number;
  /** Thời gian lấy/dựng dữ liệu, mili-giây. */
  ms?: number;
  /** Ghi chú bên phải: câu truy vấn, bộ lọc đang bật, nguồn dữ liệu. */
  note?: React.ReactNode;
  /** Hành động bên phải cùng: phân trang, xuất file. */
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
