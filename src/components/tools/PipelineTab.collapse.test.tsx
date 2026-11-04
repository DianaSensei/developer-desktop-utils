import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PipelineTab } from '@/components/tools/PipelineTab';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';

const STEPS = 'devtool:base64:pipeline:steps-v2';
const COLLAPSED = 'devtool:base64:pipeline:collapsed';

function seed(middle: object[]) {
  storageSet(STEPS, JSON.stringify([
    { id: 'a', op: 'text-sunk', textValue: '{"b":1,"a":2}' },
    ...middle,
    { id: 'z', op: 'json-stringify', stringifyMinify: true, stringifyQuotes: true },
  ]));
}
const renderTab = () => render(<AppConfigProvider><LocaleProvider><PipelineTab active /></LocaleProvider></AppConfigProvider>);

beforeEach(() => { storageRemove(STEPS); storageRemove(COLLAPSED); });
afterEach(() => cleanup());

describe('Pipeline — collapse to first and last step', () => {
  it('hides the middle steps behind one bar, keeps the result, and expands on click', async () => {
    seed([{ id: 'b', op: 'json-sort-keys', jsonSort: 'asc', jsonIndent: 'minify' }, { id: 'c', op: 'json-minify' }]);
    renderTab();
    await waitFor(() => expect(screen.getAllByText('"{\\"a\\":2,\\"b\\":1}"').length).toBeGreaterThan(0));
    expect(screen.getByText('4 steps')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Collapse to first and last step/ }));
    const bar = screen.getByRole('button', { name: /2 steps hidden/ });
    expect(bar.textContent).toMatch(/2Sort Keys.*3JSON Minify/);
    // The step editors of the middle steps are gone; first and last remain.
    expect(screen.queryByRole('tablist', { name: 'Order' })).toBeNull();
    expect(screen.getAllByText('"{\\"a\\":2,\\"b\\":1}"').length).toBeGreaterThan(0);
    expect(JSON.parse(storageGet(COLLAPSED)!)).toBe(true);

    fireEvent.click(bar);
    expect(screen.queryByRole('button', { name: /steps hidden/ })).toBeNull();
    expect(screen.getByRole('tablist', { name: 'Order' })).toBeTruthy();
  });

  it('a failing hidden step turns the bar red', async () => {
    storageSet(COLLAPSED, 'true');
    storageSet(STEPS, JSON.stringify([
      { id: 'a', op: 'text-sunk', textValue: 'not json' },
      { id: 'b', op: 'json-minify' },
      { id: 'c', op: 'uppercase' },
      { id: 'z', op: 'trim' },
    ]));
    renderTab();
    await waitFor(() => expect(screen.getByRole('button', { name: /2 steps hidden · 1 failed/ })).toBeTruthy());
  });

  it('with two steps or fewer there is nothing to collapse', () => {
    storageSet(COLLAPSED, 'true');
    storageSet(STEPS, JSON.stringify([{ id: 'a', op: 'text-sunk', textValue: 'x' }, { id: 'z', op: 'uppercase' }]));
    renderTab();
    expect(screen.queryByRole('button', { name: /Collapse to first and last step|Show all steps/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /steps hidden/ })).toBeNull();
  });
});
