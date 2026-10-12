// Keyboard shortcut, used standalone (<Keycap>⌘K</Keycap>) or inline in a
// button after a thin divider: <Button sc="⌘⏎">Run</Button> → [ Run │ ⌘⏎ ].
// `mod` picks ⌘ or Ctrl for the OS.

import * as React from 'react';
import { cn } from '@/lib/utils';
// Re-exported for existing callers; defined in src/lib/platform.ts.
import { IS_MAC, MOD_KEY } from '@/lib/platform';
export { IS_MAC, MOD_KEY };

export interface KeycapProps extends React.HTMLAttributes<HTMLElement> {
  /** Prefixes the OS modifier key: `<Keycap mod>K</Keycap>` → ⌘K / CtrlK. */
  mod?: boolean;
  /** Inline variant for buttons: inherits text color, no background. */
  inline?: boolean;
  children: React.ReactNode;
}

export function Keycap({ mod, inline, className, children, ...props }: KeycapProps) {
  const label = mod ? (
    <>
      {MOD_KEY}
      {IS_MAC ? '' : '+'}
      {children}
    </>
  ) : (
    children
  );

  return (
    <kbd
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-mono text-[11px] leading-none',
        inline
          ? // Inside a button: just a divider in the button's own color
            // (border-current), dimmed on the element because currentColor
            // takes no alpha modifier.
            'ml-2 border-l border-current pl-2 opacity-60'
          : 'rounded-xs border border-line bg-bg-2/60 px-1.5 py-1 text-fg-mute',
        className,
      )}
      {...props}
    >
      {label}
    </kbd>
  );
}
