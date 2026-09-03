import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type Status = 'success' | 'error' | 'warning' | 'info';

interface StatusMessageProps {
  status: Status;
  message: string;
  onDismiss?: () => void;
  dismissible?: boolean;
  className?: string;
}

/* `success-state` / `error-state` / `warning-state` KHÔNG TỒN TẠI ở đâu cả —
   không có trong `design/tokens.css`, `src/design-system/tokens.css`, preset,
   hay `globals.css`. Chúng là tàn dư của một hệ đặt tên đã bị bỏ, và vì
   Tailwind lặng lẽ bỏ qua class không khớp gì, ba trong bốn trạng thái của
   banner này nhiều tháng nay render ra KHÔNG MÀU: cùng `border` xám, cùng chữ
   xám, chỉ khác cái icon. Nghĩa là báo lỗi và báo thành công trông y hệt nhau.

   Chỉ `info` là đúng, vì nó viết thẳng bằng token. Ba dòng còn lại giờ theo
   đúng khuôn đó. */
const STATUS_CONFIG: Record<Status, { icon: React.ComponentType<any>; className: string }> = {
  success: {
    icon: CheckCircle2,
    className: 'bg-ok-tint border-ok-edge text-ok',
  },
  error: {
    icon: AlertCircle,
    className: 'bg-bad-tint border-bad-edge text-bad',
  },
  warning: {
    icon: AlertTriangle,
    className: 'bg-warn-tint border-warn-edge text-warn',
  },
  info: {
    icon: Info,
    className: 'bg-info-tint border-info-edge text-info',
  },
};

export function StatusMessage({
  status,
  message,
  onDismiss,
  dismissible = true,
  className,
}: StatusMessageProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        // `animate-slide-up` cũng không tồn tại (xem ghi chú trên) — banner này
        // vốn dĩ chưa từng có animation vào nào, nó chỉ NHẢY ra giữa layout và
        // đẩy mọi thứ bên dưới xuống. Thay bằng `pop-in` thật, có trong preset.
        'flex items-start gap-3 rounded-lg border px-4 py-3',
        'motion-safe:animate-pop-in',
        config.className,
        className
      )}
      role="alert"
    >
      <Icon className="h-5 w-5 shrink-0 mt-0.5" />
      <div className="flex-1 text-sm">{message}</div>
      {dismissible && onDismiss && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="h-5 w-5 p-0 ml-2"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
