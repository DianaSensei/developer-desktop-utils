import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { storageGet, storageSet } from '@/lib/persistentStore';

/** A crash caused by saved state has a way out: clear that tool's data. */

const KEY = 'devtool:json:json:input';

function Crashy() {
  if (storageGet(KEY) === '"bad"') throw new Error('saved state is broken');
  return <p>tool ok</p>;
}

afterEach(() => cleanup());

describe('ErrorBoundary', () => {
  it("clearing the tool's data recovers from a crash in saved state", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    storageSet(KEY, '"bad"');
    storageSet('devtool:regex:regex:pattern', '"keep"');
    render(
      <AppConfigProvider>
      <LocaleProvider>
        <ErrorBoundary toolId="json" toolLabel="JSON Formatter">
          <Crashy />
        </ErrorBoundary>
      </LocaleProvider>
      </AppConfigProvider>,
    );
    expect(screen.getByText(/saved state is broken/)).toBeTruthy();
    // Retry alone crashes again.
    fireEvent.click(screen.getByRole('button', { name: /Try again|Thử lại/ }));
    expect(screen.getByText(/saved state is broken/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Clear this tool|Xoá dữ liệu của tool/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Clear and reopen|Xoá và mở lại/ }));
    expect(await screen.findByText('tool ok')).toBeTruthy();
    expect(storageGet(KEY)).toBeNull();
    // Other tools are untouched.
    expect(storageGet('devtool:regex:regex:pattern')).toBe('"keep"');
  });
});
