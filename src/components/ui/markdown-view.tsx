import type { MouseEvent } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMessages } from '@/contexts/LocaleContext';
import UI from '@/components/ui/ui.messages';

/**
 * Markdown đã render, style bằng token của design system.
 *
 * Vì sao không dùng `prose` như trước: class `prose` đến từ plugin
 * `@tailwindcss/typography`, mà app KHÔNG cài plugin đó — trong CSS build ra
 * không có một rule `.prose` nào. Preview của Markdown tool và Meeting Notes
 * vì thế hiện ra như văn bản trơn: heading cùng cỡ chữ thân, list mất dấu
 * đầu dòng (preflight của Tailwind xoá), code block không nền. Gắn style ngay
 * trên từng phần tử thì không phụ thuộc plugin nào, và màu đi theo token nên
 * sáng/tối/accent đều đúng.
 *
 * Hai hành vi bắt buộc trong webview của app desktop:
 *   • LINK không được điều hướng chính cửa sổ app — `<a href>` bấm vào sẽ thay
 *     cả giao diện bằng trang web đích, và app không có nút Back (⌘[ và
 *     Backspace đã bị chặn trong useDesktopChrome). Mọi link đi qua
 *     `onOpenLink` (thường là `sdk.openExternal`) để mở bằng trình duyệt.
 *   • ẢNH REMOTE bị CSP chặn (`img-src 'self' data: blob:`) — để mặc định là một
 *     icon ảnh vỡ không giải thích gì. Thay bằng một chip ghi rõ là ảnh từ xa,
 *     bấm để mở ở trình duyệt.
 */
export interface MarkdownViewProps {
  children: string;
  /** Mở một URL http(s)/mailto ra ngoài app. Bỏ trống = link chỉ hiển thị. */
  onOpenLink?: (url: string) => void;
  /** Nhãn chip thay cho ảnh remote không có alt (đã dịch). */
  remoteImageLabel?: string;
  className?: string;
}

const EXTERNAL = /^(https?:|mailto:)/i;
const INLINE_IMAGE = /^(data:|blob:)/i;

export function MarkdownView({ children, onOpenLink, remoteImageLabel, className }: MarkdownViewProps) {
  const ui = useMessages(UI);
  remoteImageLabel ??= ui('remoteImage');
  const openLink = (href: string | undefined) => (e: MouseEvent) => {
    e.preventDefault();
    if (href && EXTERNAL.test(href)) onOpenLink?.(href);
  };

  const components: Components = {
    h1: (p) => <h1 className="mb-3 mt-5 border-b border-line pb-1.5 text-xl font-semibold first:mt-0" {...strip(p)} />,
    h2: (p) => <h2 className="mb-2.5 mt-5 border-b border-line pb-1 text-lg font-semibold first:mt-0" {...strip(p)} />,
    h3: (p) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0" {...strip(p)} />,
    h4: (p) => <h4 className="mb-2 mt-4 text-sm font-semibold first:mt-0" {...strip(p)} />,
    h5: (p) => <h5 className="mb-2 mt-3 text-sm font-semibold text-fg-mute first:mt-0" {...strip(p)} />,
    h6: (p) => <h6 className="mb-2 mt-3 text-xs font-semibold uppercase tracking-wide text-fg-mute first:mt-0" {...strip(p)} />,
    p: (p) => <p className="my-2.5 leading-relaxed" {...strip(p)} />,
    ul: (p) => <ul className="my-2.5 list-disc space-y-1 pl-6 marker:text-fg-mute" {...strip(p)} />,
    ol: (p) => <ol className="my-2.5 list-decimal space-y-1 pl-6 marker:text-fg-mute" {...strip(p)} />,
    li: ({ className: c, ...p }) => (
      // GFM task list: `- [ ] việc` — bỏ dấu đầu dòng, checkbox thay chỗ nó.
      <li className={cn('leading-relaxed', c?.includes('task-list-item') && '-ml-6 list-none')} {...strip(p)} />
    ),
    input: (p) => (
      <input {...strip(p)} disabled className="mr-1.5 translate-y-px accent-acc" />
    ),
    blockquote: (p) => <blockquote className="my-3 border-l-2 border-acc/50 pl-3 text-fg-mute" {...strip(p)} />,
    hr: () => <hr className="my-5 border-line" />,
    a: ({ href, children: c }) => (
      <a
        href={href}
        onClick={openLink(href)}
        title={href}
        className="text-acc underline decoration-acc/40 underline-offset-2 hover:decoration-acc"
      >
        {c}
      </a>
    ),
    img: ({ src, alt }) => {
      const url = typeof src === 'string' ? src : '';
      if (INLINE_IMAGE.test(url)) return <img src={url} alt={alt ?? ''} className="my-2 max-w-full rounded-sm" />;
      return (
        <a
          href={url}
          onClick={openLink(url)}
          title={url}
          className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-sunk px-2 py-0.5 text-xs text-fg-mute hover:text-fg"
        >
          <ImageOff className="h-3.5 w-3.5 shrink-0" />
          {alt || remoteImageLabel}
        </a>
      );
    },
    code: ({ className: c, children: code, ...p }) => {
      // Khối code (```lang) có `language-*`; code nội dòng thì không.
      const block = /language-/.test(c ?? '') || String(code).includes('\n');
      return block ? (
        <code className={cn('font-mono text-xs', c)} {...strip(p)}>{code}</code>
      ) : (
        <code className="rounded-xs bg-sunk px-1 py-0.5 font-mono text-[0.9em]" {...strip(p)}>{code}</code>
      );
    },
    pre: (p) => <pre className="my-3 overflow-x-auto rounded-sm border border-line bg-sunk p-3 leading-relaxed" {...strip(p)} />,
    table: (p) => (
      <div className="my-3 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm" {...strip(p)} />
      </div>
    ),
    th: (p) => <th className="border border-line bg-sunk px-2.5 py-1.5 font-semibold" {...strip(p)} />,
    td: (p) => <td className="border border-line px-2.5 py-1.5 align-top" {...strip(p)} />,
    del: (p) => <del className="text-fg-mute" {...strip(p)} />,
  };

  return (
    <div className={cn('text-sm text-fg [overflow-wrap:anywhere]', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** react-markdown đưa `node` (cây AST) vào props — không được rơi xuống DOM. */
function strip<T extends { node?: unknown }>(props: T): Omit<T, 'node'> {
  const { node: _node, ...rest } = props;
  void _node;
  return rest;
}
