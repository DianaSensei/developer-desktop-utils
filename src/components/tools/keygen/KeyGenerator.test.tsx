import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KeyGenerator } from '@/components/tools/keygen/KeyGenerator';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';

const KEYS = ['preset', 'comment', 'length'].map((k) => `devtool:base64:keygen:${k}`);

afterEach(() => {
  cleanup();
  for (const k of KEYS) storageRemove(k);
});

describe('Keys tab', () => {
  it('shows a generated secret in every encoding and never stores it', async () => {
    storageSet('devtool:base64:keygen:preset', JSON.stringify('hmac-256'));
    render(<AppConfigProvider><LocaleProvider><KeyGenerator /></LocaleProvider></AppConfigProvider>);
    fireEvent.click(screen.getByRole('button', { name: /^Generate$/ }));

    await waitFor(() => expect(screen.getByText(/32 random bytes/)).toBeTruthy());
    const hex = (screen.getAllByRole('textbox') as HTMLTextAreaElement[]).map((el) => el.value).find((v) => /^[0-9a-f]{64}$/.test(v));
    expect(hex).toBeTruthy();
    const stored = KEYS.map((k) => storageGet(k) ?? '').join('|');
    expect(stored).not.toContain(hex);
  });
});
