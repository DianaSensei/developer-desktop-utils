import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GenerateCodeDialog } from './GenerateCodeDialog';
import type { PreparedRequest } from './engine';
import { newRequest } from './types';

// CopyButton writes through the platform clipboard SDK, which jsdom has no
// host for; what these tests check is the snippet and the controls around it.
vi.mock('@/components/ui/copy-button', () => ({ CopyButton: () => null }));

const prepared = (over: Partial<PreparedRequest> = {}): PreparedRequest => ({
  request: newRequest({
    url: 'https://api.test/me',
    headers: [{ id: 'h1', key: 'Authorization', value: 'Bearer {{vault.token}}', enabled: true }],
  }),
  vars: { 'vault.token': 's3cret-value' },
  inheritedHeaders: [],
  stores: { collectionVar: {}, collectionEnv: {}, globalEnv: {}, collectionEnvName: null, globalEnvName: null },
  tests: [],
  logs: [],
  errors: [],
  ...over,
});

const secrets = { keys: ['vault.token'], values: ['s3cret-value'] };
const bodyText = () => document.body.textContent ?? '';

describe('GenerateCodeDialog', () => {
  it('masks secrets by default and warns once they are included', async () => {
    const p = prepared();
    render(<GenerateCodeDialog open onClose={() => {}} prepare={async () => p} secrets={secrets} />);

    const toggle = await screen.findByRole('switch', { name: 'Include secrets' });
    expect(bodyText()).not.toContain('s3cret-value');

    fireEvent.click(toggle);
    await waitFor(() => expect(bodyText()).toContain('Bearer s3cret-value'));
    expect(bodyText()).toContain('take care where you paste it');
  });

  it('hides the secrets switch when the request uses no secret', async () => {
    const p = prepared({ request: newRequest({ url: 'https://api.test/plain' }) });
    render(<GenerateCodeDialog open onClose={() => {}} prepare={async () => p} secrets={secrets} />);
    await waitFor(() => expect(bodyText()).toContain('https://api.test/plain'));
    expect(screen.queryByRole('switch', { name: 'Include secrets' })).toBeNull();
  });

  it('starts masked again on the next opening', async () => {
    const p = prepared();
    const prepare = async () => p;
    const { rerender } = render(<GenerateCodeDialog open onClose={() => {}} prepare={prepare} secrets={secrets} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Include secrets' }));
    await waitFor(() => expect(bodyText()).toContain('s3cret-value'));

    rerender(<GenerateCodeDialog open={false} onClose={() => {}} prepare={prepare} secrets={secrets} />);
    rerender(<GenerateCodeDialog open onClose={() => {}} prepare={prepare} secrets={secrets} />);
    const toggle = await screen.findByRole('switch', { name: 'Include secrets' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(bodyText()).not.toContain('s3cret-value');
  });

  it('says a pre-request script failed instead of passing the snippet off as what Send does', async () => {
    const p = prepared({ errors: ['Pre-request script: boom'] });
    render(<GenerateCodeDialog open onClose={() => {}} prepare={async () => p} secrets={secrets} />);
    await waitFor(() => expect(bodyText()).toContain('Pre-request script: boom'));
    expect(bodyText()).toContain('A pre-request script failed');
  });
});
