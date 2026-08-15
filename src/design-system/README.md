# DevTool Design System — lớp app

> **Giá trị không nằm ở đây.** Nguồn sự thật là [`design/`](../../design/) —
> bộ design kit dùng chung với trang mẫu tĩnh. Thư mục này chỉ là lớp app:
> nó `@import` token của kit, bắc cầu từ vựng cũ sang từ vựng kit, và giữ những
> thứ cần Tailwind xử lý (`@layer` / `@apply`).
>
> Sửa màu, bo góc, chiều cao control → sửa `design/tokens.css`.
> Luật thiết kế → [`design/RULES.md`](../../design/RULES.md).

## What's in here

| File | Purpose |
|---|---|
| `tokens.css` | `@import` kit; **lớp bắc cầu** ánh xạ token cũ (`--background`, `--primary`…) sang kênh của kit (`--bg-c`, `--acc-c`…); base resets; cross-platform scrollbar; utility cần Tailwind. |
| `tailwind-preset.cjs` | Kế thừa preset của kit rồi giữ lại 13 tên màu cũ để ~2430 chỗ gọi không phải sửa. |
| `index.ts` | One import surface for all React primitives + `cn`. |

### Hai từ vựng cùng tồn tại

Code **mới** dùng từ vựng của kit: `bg-acc`, `text-fg-mute`, `border-line`,
`bg-ok-tint`, `h-ctl`, `rounded-md`, `shadow`.

Code **cũ** vẫn dùng `bg-primary`, `text-muted-foreground`, `border-border` — chúng
vẫn chạy và đã nhận bảng màu mới, nhưng là lớp tạm. G4 di cư theo từng tool, G5 xoá.

> Components themselves live in `src/components/ui/` (shadcn-style, Radix-based)
> and are re-exported by `index.ts`. To lift the whole system into another
> project, copy `src/design-system/` **and** `src/components/ui/` (plus
> `src/lib/utils.ts` for `cn`).

## Reuse in another project

1. **Copy** `src/design-system/` (and `src/components/ui/`, `src/lib/utils.ts`).
2. **CSS** — at the very top of your global stylesheet, before the `@tailwind`
   directives (Vite inlines the import so Tailwind processes the layers):

   ```css
   @import "../design-system/tokens.css";
   @tailwind base;
   @tailwind components;
   @tailwind utilities;
   ```

3. **Tailwind** — consume the preset:

   ```js
   // tailwind.config.js
   module.exports = {
     presets: [require('./src/design-system/tailwind-preset.cjs')],
     content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
   };
   ```

4. **Font** — Be Vietnam Pro (sans) + IBM Plex Mono. Không có bản variable trên
   fontsource nên nạp từng trọng lượng; subset `vietnamese` chứa dấu chồng hai tầng:

   ```ts
   import '@fontsource/be-vietnam-pro/latin-400.css';      // + 500, 600
   import '@fontsource/be-vietnam-pro/vietnamese-400.css'; // + 500, 600
   import '@fontsource/ibm-plex-mono/latin-400.css';       // + 500, 600
   ```

5. **Use it**:

   ```tsx
   import { Button, Card, Segmented, ToolToolbar, PaneHeader, cn } from '@/design-system';
   ```

## Token reference (set via CSS variables in `tokens.css`)

- **Surfaces**: `--background`, `--sidebar`, `--card`, `--popover`, `--elevated`
- **Text**: `--foreground`, `--muted-foreground`
- **Accent**: `--primary`, `--accent`, `--ring`, `--accent-glow` (HSL components)
- **Lines/fields**: `--border`, `--input`, `--secondary`, `--muted`
- **Status**: `--destructive` — giờ trỏ vào `--bad-c` của hệ trạng thái
- **Editor syntax**: `--sql-*`, `--js-*` (hệ riêng, không theo accent)

Bo góc, bóng, chuyển động, chiều cao control nay do kit quản:
xem [`design/TOKENS.md`](../../design/TOKENS.md).

## Utility classes

- **Glass**: `.glass`, `.glass-strong`, `.glass-chrome`, `.glass-sheen`
- **Elevation**: `.shadow-primary`, `.shadow-primary-lg`; `.shadow-sm-premium … .shadow-2xl-premium` là **bí danh tạm** ánh xạ xuống 3 bậc của kit
- **Motion**: `.hover-elevate` (không còn nhấc phần tử), `.press`, `.animate-fade-in-up`, `.animate-scale-in`
- **Chrome**: `.sidebar-premium`, `.header-premium`, `.content-wrapper`
- **Typography**: `.heading-xl…xs`, `.text-body`, `.text-caption`

> Đã xoá ở G1 (0 lượt dùng trong code): `.card-premium`, `.card-interactive`,
> `.container-premium`, `.badge-premium`, `.tab-premium`, `.input-premium`,
> `.textarea-premium`, `.btn-*-premium`, `.accent-glow*`, `.animate-pop`.
> Dùng `<Card>`, `<Badge>`, `<Input>`, `<Button>` thay vì dựng lại bằng CSS.

## Principles

- **Accent used sparingly.** Selections/active states are a light **tint**
  (`bg-primary/10` + accent text), never a saturated fill. Reserve solid blue for
  primary buttons, focus rings, and key emphasis.
- **Semantic colors stay semantic** — warnings (amber), errors (red), success
  (green), HTTP method colors, and syntax highlighting are not accent-themed.
- **Legible glass** — heavy blur + vibrancy but high fill opacity so content on
  glass stays crisp.
- **Reduce-motion respected** — all transform animations sit behind
  `motion-safe:` and a global `prefers-reduced-motion` guard.
