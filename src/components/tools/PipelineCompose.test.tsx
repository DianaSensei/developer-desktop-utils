import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PipelineTab } from '@/components/tools/PipelineTab';
import { labelFromPath } from '@/components/tools/PipelineCompose';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { storageRemove, storageSet } from '@/lib/persistentStore';

const STEPS_KEY = 'devtool:base64:pipeline:steps-v2';

afterEach(() => {
  cleanup();
  storageRemove(STEPS_KEY);
  sessionStorage.clear();
});

const renderTab = () => render(<AppConfigProvider><LocaleProvider><PipelineTab active /></LocaleProvider></AppConfigProvider>);

describe('Pipeline — Compose step', () => {
  it('labels a picked field by its last path segment', () => {
    expect(labelFromPath('data.amount')).toBe('amount');
    expect(labelFromPath('items[0].id')).toBe('id');
    expect(labelFromPath('$.a["b.c"]')).toBe('a');
    expect(labelFromPath('plain')).toBe('plain');
  });

  it('shows the composed string, and adds an editable part', async () => {
    storageSet(STEPS_KEY, JSON.stringify([
      { id: 's1', op: 'text-sunk', textValue: '{"data":{"amount":100,"orderId":"A1"}}' },
      {
        id: 's2', op: 'compose', jsonSeparator: '&', jsonSort: 'asc', jsonFormat: 'key=value',
        composeParts: [
          { id: 'p1', enabled: true, source: 'json-path', value: 'data.orderId', label: 'order' },
          { id: 'p2', enabled: true, source: 'json-path', value: 'data.amount', label: 'amount' },
        ],
      },
    ]));
    const view = renderTab();
    await waitFor(() => expect(view.container.textContent).toContain('amount=100&order=A1'));

    fireEvent.click(screen.getByRole('button', { name: /Add part/ }));
    const labels = await screen.findAllByRole('textbox', { name: 'label' });
    expect(labels).toHaveLength(3);
    fireEvent.change(labels[2], { target: { value: 'key' } });
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Text' })[0], { target: { value: 'M01' } });
    await waitFor(() => expect(view.container.textContent).toContain('amount=100&key=M01&order=A1'));
  });
});
