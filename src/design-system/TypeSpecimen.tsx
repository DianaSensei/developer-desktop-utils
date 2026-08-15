import * as React from 'react';

/**
 * TẠM THỜI — trang so sánh mặt chữ, chỉ tồn tại trong giai đoạn G1.
 *
 * Mục đích: chọn font sans bằng QUAN SÁT chứ không bằng lý lẽ. Đề xuất
 * Be Vietnam Pro dựa trên lập luận (nó được thiết kế cho tiếng Việt), nhưng
 * lập luận không thay được việc nhìn dấu chồng hai tầng ở 11px trong đúng
 * webview mà app chạy.
 *
 * Truy cập: /type-specimen (không có trong sidebar).
 * XOÁ file này, route của nó, và font thua cuộc khi đã chốt.
 *
 * Bốn bài kiểm tra ở dưới lấy từ design/TOKENS.md.
 */

const INTER =
  '"Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const BVP =
  '"Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Cỡ chữ app dùng nhiều nhất — đây mới là chỗ font sống hay chết. */
const BODY_SIZES = [11, 12, 13, 14, 15] as const;

const PROSE =
  'Kết nối tới cụm Kafka đã được thiết lập. Bộ điều phối hiện giữ mười hai phân ' +
  'vùng, trong đó bốn phân vùng đang tồn đọng hơn một nghìn bản tin chưa xử lý.';

function Panel({ title, hint, children }: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-soft">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function TypeSpecimen() {
  const [font, setFont] = React.useState<'inter' | 'bvp'>('bvp');

  // --sans là token, nên đổi nó ở :root là cả app đổi theo ngay — kể cả phần
  // chrome ngoài trang này. Đó chính là điều cần so sánh.
  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--sans', font === 'bvp' ? BVP : INTER);
    return () => {
      root.style.removeProperty('--sans');
    };
  }, [font]);

  return (
    <div className="tool-full-height">
      <div className="tool-scrollable tool-padding">
        <div className="content-wrapper space-y-5">
          <header className="space-y-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">So sánh mặt chữ</h1>
              <p className="text-sm text-muted-foreground">
                Trang tạm của G1. Chọn font rồi đọc bốn bài dưới đây — nhất là ở 11–13px,
                cỡ mà app dùng nhiều nhất.
              </p>
            </div>
            <div
              role="tablist"
              aria-label="Chọn mặt chữ"
              className="inline-flex h-ctl items-center gap-0.5 rounded-sm border border-border bg-muted/60 p-0.5"
            >
              {([['bvp', 'Be Vietnam Pro'], ['inter', 'Inter']] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={font === key}
                  onClick={() => setFont(key)}
                  className={`inline-flex h-full items-center rounded-xs px-3 text-sm font-medium transition-colors ${
                    font === key
                      ? 'bg-card text-foreground shadow-soft'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </header>

          <Panel
            title="1 · Dấu chồng hai tầng"
            hint="Dấu thanh đặt trên dấu mũ. Font kém sẽ để hai dấu đè nhau hoặc đội lên dòng trên."
          >
            <p className="text-[40px] leading-tight">ế ộ ữ ẩ ỡ ặ ẽ ợ</p>
            <p className="mt-3 text-lg">Đội tuyển Việt Nam thắng đậm — cổ động viên vỡ oà</p>
            <p className="mt-1 text-[13px]">Đội tuyển Việt Nam thắng đậm — cổ động viên vỡ oà</p>
            <p className="mt-1 text-[11px]">Đội tuyển Việt Nam thắng đậm — cổ động viên vỡ oà</p>
          </Panel>

          <Panel
            title="2 · Dấu chạm chữ hoa"
            hint="Chữ hoa có dấu là chỗ dễ vỡ nhất: dấu hay bị cắt cụt hoặc chạm baseline dòng trên."
          >
            <p className="text-3xl font-semibold leading-snug">ĐẦY ĐỦ TIẾNG VIỆT</p>
            <p className="text-3xl font-semibold leading-snug">ỦY BAN NHÂN DÂN — Ổ CỨNG</p>
            <p className="mt-2 text-sm font-semibold">
              XUẤT KHẨU · NHẬP KHẨU · KIỂM TRA ĐỊNH KỲ
            </p>
          </Panel>

          <Panel
            title="3 · Ký tự dễ nhầm"
            hint="Quan trọng cho tool: chuỗi mã, token, hash đọc sai một ký tự là hỏng việc."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Chữ thường (sans)</p>
                <p className="text-2xl">0O oO · 1lI i! · rn m · ;: ,.</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Chữ đơn cách (IBM Plex Mono)</p>
                <p className="font-mono text-2xl">0O oO · 1lI i! · rn m · ;: ,.</p>
              </div>
            </div>
            <p className="mt-3 font-mono text-sm break-all">
              eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0
            </p>
          </Panel>

          <Panel
            title="4 · Số tabular"
            hint="Cột số phải thẳng hàng khi giá trị đổi. Nếu các chữ số nhảy ngang là font thiếu tabular-nums."
          >
            <table className="w-full max-w-md text-sm">
              <tbody className="tabular-nums">
                {[
                  ['orders', '1 284', '99,4%'],
                  ['audit-log', '40 917', '87,1%'],
                  ['payments.dlq', '8', '100,0%'],
                  ['user-events', '111 118', '11,8%'],
                ].map(([topic, count, pct]) => (
                  <tr key={topic} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 font-mono text-[13px]">{topic}</td>
                    <td className="py-1.5 text-right font-mono font-medium">{count}</td>
                    <td className="py-1.5 text-right font-mono text-muted-foreground">{pct}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel
            title="5 · Chữ thân bài ở cỡ thật"
            hint="Cỡ 11–13px là nơi phần lớn chữ trong app sống. Font đẹp ở 40px mà nhoè ở 11px là vô dụng."
          >
            <div className="space-y-3">
              {BODY_SIZES.map((px) => (
                <div key={px}>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {px}px
                  </p>
                  <p style={{ fontSize: px }} className="leading-relaxed">
                    {PROSE}
                  </p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="6 · Trọng lượng" hint="Chỉ ba trọng lượng được nạp: 400 / 500 / 600.">
            <div className="space-y-1">
              <p className="text-lg font-normal">400 — Quản lý kết nối và hàng đợi bản tin</p>
              <p className="text-lg font-medium">500 — Quản lý kết nối và hàng đợi bản tin</p>
              <p className="text-lg font-semibold">600 — Quản lý kết nối và hàng đợi bản tin</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Nếu 500 và 600 trông giống hệt nhau thì trọng lượng đó chưa nạp được.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
