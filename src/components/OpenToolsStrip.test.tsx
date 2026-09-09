import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Link } from 'react-router-dom';
import { OpenToolsStrip } from '@/components/OpenToolsStrip';
import { FeatureProvider } from '@/contexts/FeatureContext';
import { LocaleProvider } from '@/contexts/LocaleContext';

/**
 * The strip's own visited-tools tracking is covered by useOpenTools.test.ts;
 * this file covers what only the rendered component can: hiding itself below
 * two tabs, switching route on click, and the × button removing a tab
 * without navigating.
 */

function Harness({ initialPath = '/json' }: { initialPath?: string }) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <LocaleProvider>
        <FeatureProvider>
          {/* Stand-ins for real tool navigation, so a click moves the router
              the same way App.tsx's sidebar/tabs do. Both tools must be
              enabled by default (see FeatureContext's DEFAULT_FEATURES) or
              the strip filters them right back out. */}
          <Link to="/json">To JSON</Link>
          <Link to="/unix-time">To Date</Link>
          <OpenToolsStrip />
        </FeatureProvider>
      </LocaleProvider>
    </MemoryRouter>
  );
}

afterEach(() => cleanup());

describe('OpenToolsStrip', () => {
  it('renders nothing with only one tool visited', () => {
    render(<Harness />);
    expect(screen.queryByRole('tablist', { name: /session|phiên/i })).toBeNull();
  });

  it('appears once a second tool is visited, and clicking a tab navigates back', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('To Date'));
    const tablist = screen.getByRole('tablist');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tablist).toBeTruthy();

    // Date/Time is active (most recently visited); jump back to JSON.
    const jsonTab = screen.getAllByRole('tab').find((t) => t.textContent?.includes('JSON'))!;
    fireEvent.click(jsonTab);
    expect(jsonTab.getAttribute('aria-selected')).toBe('true');
  });

  it('the × button removes a tab from the strip without navigating away', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('To Date'));
    expect(screen.getAllByRole('tab')).toHaveLength(2);

    const jsonTab = screen.getAllByRole('tab').find((t) => t.textContent?.includes('JSON'))!;
    const closeBtn = jsonTab.querySelector('button')!;
    fireEvent.click(closeBtn);

    // Below 2 tabs again, so the whole strip disappears — Date/Time (the
    // current route) alone isn't worth a switch-back strip either.
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});
