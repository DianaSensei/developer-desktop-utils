import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { EncodeHashEncrypt } from '@/components/tools/EncodeHashEncrypt';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { storageGet, storageRemove } from '@/lib/persistentStore';

/** The JWT Debugger is the JWT tab now; `?tab=jwt` (old /jwt route, ⌘K) must open it. */

const TAB_KEY = 'devtool:base64:codec:tab';

afterEach(() => {
  cleanup();
  storageRemove(TAB_KEY);
});

function Search() {
  return <span data-testid="search">{useLocation().search}</span>;
}

describe('Encode·Hash·Encrypt — JWT tab', () => {
  it('opens the JWT tab from ?tab=jwt and drops the parameter', async () => {
    render(
      <AppConfigProvider><LocaleProvider>
        <MemoryRouter initialEntries={['/base64?tab=jwt']}>
          <Routes><Route path="/base64" element={<><EncodeHashEncrypt /><Search /></>} /></Routes>
        </MemoryRouter>
      </LocaleProvider></AppConfigProvider>,
    );
    await waitFor(() => expect(JSON.parse(storageGet(TAB_KEY) ?? '""')).toBe('jwt'));
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''));
    expect(screen.getByRole('tab', { name: /^JWT$/ }).getAttribute('aria-selected')).toBe('true');
  });
});
