import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from '@/components/Settings';
import { FeatureProvider } from '@/contexts/FeatureContext';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { OnboardingProvider } from '@/contexts/OnboardingContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { UpdateProvider } from '@/contexts/UpdateContext';
import { ExtensionUpdateProvider } from '@/contexts/ExtensionUpdateContext';

/** Full provider tree `Settings` needs to render in a test, shared between
 *  every `Settings.*.test.tsx` file — kept in one place so adding a
 *  provider `Settings` starts depending on means editing this one function,
 *  not every test file that renders it. `initialEntries` lets a test drive
 *  `location.state` (e.g. `desktop-devtool-app://install`'s `{ section: 'plugins' }`,
 *  see `src/lib/deepLink.ts`). */
export function renderSettings(
  initialEntries: Array<string | { pathname: string; state?: unknown }> = ['/settings'],
) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AppConfigProvider>
        <LocaleProvider>
          <FeatureProvider>
            <OnboardingProvider>
              <UpdateProvider>
                <ExtensionUpdateProvider>
                  <Settings />
                </ExtensionUpdateProvider>
              </UpdateProvider>
            </OnboardingProvider>
          </FeatureProvider>
        </LocaleProvider>
      </AppConfigProvider>
    </MemoryRouter>,
  );
}
