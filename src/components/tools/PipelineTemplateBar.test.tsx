import { afterEach, describe, expect, it } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import { PipelineTab } from '@/components/tools/PipelineTab';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';
import { secretGet } from '@/platform/secrets';

const STEPS_KEY = 'devtool:base64:pipeline:steps-v2';
const TEMPLATES_KEY = 'devtool:base64:pipeline:templates';

afterEach(() => {
  cleanup();
  for (const k of [STEPS_KEY, TEMPLATES_KEY, 'devtool:base64:pipeline:active-template']) storageRemove(k);
  sessionStorage.clear();
});

const renderTab = () => render(<AppConfigProvider><LocaleProvider><PipelineTab active /></LocaleProvider></AppConfigProvider>);

describe('Pipeline — templates', () => {
  it('saves the pipeline without its key, keeps the key in the vault, and loads it back', async () => {
    storageSet(STEPS_KEY, JSON.stringify([
      { id: 's1', op: 'text-sunk', textValue: 'amount=100' },
      { id: 's2', op: 'hmac', algorithm: 'sha256' },
    ]));
    const view = renderTab();

    // Give the HMAC step a key (goes to the vault).
    const keyBox = await screen.findByPlaceholderText('Secret key…');
    fireEvent.change(keyBox, { target: { value: 'sk_test_ABC' } });

    fireEvent.click(screen.getByRole('button', { name: /Save as template/ }));
    fireEvent.change(screen.getByPlaceholderText('Template name'), { target: { value: 'MoMo sandbox' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Remember keys/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(storageGet(TEMPLATES_KEY)).toContain('MoMo sandbox'));
    const stored = storageGet(TEMPLATES_KEY)!;
    expect(stored).not.toContain('sk_test_ABC');
    expect(stored).not.toContain('amount=100');
    await waitFor(async () => expect(await secretGet('base64', 'pipeline:template-keys')).toContain('sk_test_ABC'));

    // Load it over the current pipeline: input cleared, key restored.
    fireEvent.click(screen.getByRole('button', { name: /^Templates$/ }));
    const row = (await screen.findByText('MoMo sandbox')).closest('div.group\\/tpl') as HTMLElement;
    fireEvent.click(row.querySelector('button')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Load' }));

    await waitFor(() => expect(JSON.parse(storageGet(STEPS_KEY)!)[0].textValue).toBe(''));
    const loaded = JSON.parse(storageGet(STEPS_KEY)!) as { id: string }[];
    await waitFor(async () => {
      expect(JSON.parse((await secretGet('base64', 'pipeline:step-keys'))!)).toEqual({ [loaded[1].id]: 'sk_test_ABC' });
    });
    expect(view.container.textContent).toContain('From template: MoMo sandbox');
  });
});
