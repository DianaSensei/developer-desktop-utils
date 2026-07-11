import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { storageGet, storageSet, wasFreshInstall } from '@/lib/persistentStore';

const COMPLETED_KEY = 'devtool-onboarding-completed';

interface OnboardingContextValue {
  /** Whether the onboarding dialog should be rendered open right now. */
  show: boolean;
  /** True once onboarding has been completed/skipped at least once — lets a reopen skip the welcome pitch. */
  completed: boolean;
  /** Re-open the flow on demand (e.g. "Xem lại hướng dẫn" in Settings). */
  open: () => void;
  /** Close the flow and permanently mark onboarding as completed (skip or finish — same effect). */
  close: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

// Whether onboarding has ever been completed/skipped, or should be treated as
// such because this is an existing install rather than a brand-new one — an
// upgrade that ships onboarding must not retroactively show it to people who
// already know the app.
function loadInitialCompleted(): boolean {
  if (storageGet(COMPLETED_KEY) === 'true') return true;
  if (!wasFreshInstall()) {
    storageSet(COMPLETED_KEY, 'true');
    return true;
  }
  return false;
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [completed, setCompleted] = useState(loadInitialCompleted);
  const [show, setShow] = useState(() => !completed);

  const open = useCallback(() => setShow(true), []);

  const close = useCallback(() => {
    setShow(false);
    setCompleted(true);
    storageSet(COMPLETED_KEY, 'true');
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({ show, completed, open, close }),
    [show, completed, open, close]
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider');
  return ctx;
}
