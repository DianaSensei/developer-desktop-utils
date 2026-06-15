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
          <stop offset="0%"   stopColor="#0E639C" />
          <stop offset="100%" stopColor="#003F6E" />
        </linearGradient>
        <linearGradient id="logo-shine" x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%"  stopColor="#FFFFFF" stopOpacity="0.10" />
          <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Background */}
      <rect width="100" height="100" rx="22" ry="22" fill="url(#logo-bg)" />
      <rect width="100" height="100" rx="22" ry="22" fill="url(#logo-shine)" />

      {/* > chevron */}
      <polyline
        points="18.75,26.6 44.5,50 18.75,73.4"
        fill="none"
        stroke="white"
        strokeWidth="8.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.94"
      />
      {/* _ dash / cursor */}
      <line
        x1="48.8" y1="71.7"
        x2="81.6" y2="71.7"
        stroke="white"
        strokeWidth="7.2"
        strokeLinecap="round"
        opacity="0.94"
      />
    </svg>
  );
}
