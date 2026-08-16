# DevTool Design System — lớp app

> **Giá trị không nằm ở đây.** Nguồn sự thật là [`design/`](../../design/) —
> bộ design kit dùng chung với trang mẫu tĩnh. Thư mục này chỉ là lớp app:
> nó `@import` token của kit và giữ những thứ cần Tailwind xử lý
> (`@layer` / `@apply`).
>
> Sửa màu, bo góc, chiều cao control → sửa `design/tokens.css`.
> Luật thiết kế → [`design/RULES.md`](../../design/RULES.md).

## What's in here

| File | Purpose |
|---|---|
| `tokens.css` | `@import` kit; base resets; cross-platform scrollbar; utility cần Tailwind. |
| `tailwind-preset.cjs` | Kế thừa preset của kit; giữ bí danh `boxShadow` cho `shadow-sm/md/lg/xl/2xl` gốc. |
| `index.ts` | One import surface for all React primitives + `cn`. |

Toàn bộ `src/` dùng MỘT từ vựng — tên của kit: `bg-acc`, `text-fg-mute`,
`border-line`, `bg-ok-tint`, `h-ctl`, `rounded-md`, `shadow`. Lớp bắc cầu từ
vựng cũ (`bg-primary`, `text-muted-foreground`, `border-border`…) từng tồn
tại tạm thời trong G1–G4 đã bị xoá ở G5 sau khi đổi tên hết mọi chỗ gọi.

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

## Token reference

Toàn bộ bảng token (bề mặt, chữ, accent, trạng thái, bo góc, bóng, chuyển
động, chiều cao control) do kit quản lý — xem
[`design/TOKENS.md`](../../design/TOKENS.md). File này chỉ còn giữ riêng
bảng màu cú pháp editor (`--sql-*`, `--js-*`, hệ riêng không theo accent)
và màu HTTP method (`--method-*-c`).

## Utility classes

- **Glass**: `.glass`, `.glass-strong`, `.glass-chrome`, `.glass-sheen`
- **Elevation**: `.shadow-primary`, `.shadow-primary-lg`; dùng thẳng `shadow-sm`/`shadow`/`shadow-lg` (đã ánh xạ xuống 3 bậc của kit trong `tailwind-preset.cjs`)
- **Motion**: `.hover-elevate` (không còn nhấc phần tử), `.press`, `.animate-fade-in-up`, `.animate-scale-in`
- **Chrome**: `.sidebar-chrome`, `.header-chrome`, `.content-wrapper`
- **Typography**: `.heading-xl…xs`, `.text-body`, `.text-caption`

> Đã xoá ở G1 (0 lượt dùng trong code): `.card-premium`, `.card-interactive`,
> `.container-premium`, `.badge-premium`, `.tab-premium`, `.input-premium`,
> `.textarea-premium`, `.btn-*-premium`, `.accent-glow*`, `.animate-pop`.
> Dùng `<Card>`, `<Badge>`, `<Input>`, `<Button>` thay vì dựng lại bằng CSS.

## Principles

- **Accent used sparingly.** Selections/active states are a light **tint**
  (`bg-acc/10` + accent text), never a saturated fill. Reserve solid blue for
  primary buttons, focus rings, and key emphasis.
- **Semantic colors stay semantic** — warnings (amber), errors (red), success
  (green), HTTP method colors, and syntax highlighting are not accent-themed.
- **Legible glass** — heavy blur + vibrancy but high fill opacity so content on
  glass stays crisp.
- **Reduce-motion respected** — all transform animations sit behind
  `motion-safe:` and a global `prefers-reduced-motion` guard.
