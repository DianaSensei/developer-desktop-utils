import { cn } from '@/lib/utils';

interface AppLogoProps {
  size?: number;
  className?: string;
}

export function AppLogo({ size = 28, className }: AppLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('flex-shrink-0', className)}
    >
      <defs>
        <linearGradient id="logo-bg" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0D1F35" />
          <stop offset="100%" stopColor="#0A1628" />
        </linearGradient>
        <radialGradient id="logo-bloom" cx="50%" cy="52%" r="42%">
          <stop offset="0%" stopColor="#1A5A8A" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#0A1628" stopOpacity="0" />
        </radialGradient>
        <filter id="logo-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Background */}
      <rect width="100" height="100" rx="22" ry="22" fill="url(#logo-bg)" />
      <rect width="100" height="100" rx="22" ry="22" fill="url(#logo-bloom)" />

      {/* >_ symbol */}
      <g filter="url(#logo-glow)">
        <polyline
          points="16,27 45,50 16,73"
          fill="none"
          stroke="#38BDF8"
          strokeWidth="9.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1="52" y1="71"
          x2="84" y2="71"
          stroke="#38BDF8"
          strokeWidth="8.5"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
