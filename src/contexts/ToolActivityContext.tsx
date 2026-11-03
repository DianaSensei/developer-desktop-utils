// Whether the tool rendering this subtree is the one the user is working in.
//
// Open tools stay mounted while their tab is in the background (ToolHost.tsx),
// and with a split view two are visible at once. Window-level shortcuts,
// ⌘V quick-paste, OS file drops and header actions must only act for the
// tool in front, so they read `active` here. Outside a ToolHost (tests, a
// tool rendered on its own) the defaults mean "active and visible".

import { createContext, useContext, useRef, type MutableRefObject, type ReactNode } from 'react';

export interface ToolActivity {
  /** The tool the keyboard belongs to: the only tab shown, or the focused pane of a split. */
  active: boolean;
  /** On screen (it may be visible but not active in a split). */
  visible: boolean;
}

const ToolActivityContext = createContext<ToolActivity>({ active: true, visible: true });

export function ToolActivityProvider({ value, children }: { value: ToolActivity; children: ReactNode }) {
  return <ToolActivityContext.Provider value={value}>{children}</ToolActivityContext.Provider>;
}

export function useToolActivity(): ToolActivity {
  return useContext(ToolActivityContext);
}

/** For window listeners registered once: `if (!activeRef.current) return;`. */
export function useToolActiveRef(): MutableRefObject<boolean> {
  const { active } = useContext(ToolActivityContext);
  const ref = useRef(active);
  ref.current = active;
  return ref;
}
