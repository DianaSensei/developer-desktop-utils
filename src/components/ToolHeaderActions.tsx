import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders its children into the global app header's action slot
 * (`#tool-header-actions`, declared in App.tsx). Lets a tool contribute
 * tool-specific buttons to the shared header without lifting state up.
 */
export function ToolHeaderActions({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById('tool-header-actions'));
    return () => setTarget(null);
  }, []);

  return target ? createPortal(children, target) : null;
}
