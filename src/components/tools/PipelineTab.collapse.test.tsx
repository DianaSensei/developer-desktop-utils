import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PipelineTab } from '@/components/tools/PipelineTab';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';

const STEPS = 'devtool:base64:pipeline:steps-v2';
const COLLAPSED = 'devtool:base64:pipeline:collapsed';
const RESULT = '"{\\"a\\":2,\\"b\\":1}"';

function seed() {
  storageSet(STEPS, JSON.stringify([
    { id: 'a', op: 'text-sunk', textValue: '{"b":1,"a":2}' },
    { id: 'b', op: 'json-sort-keys', jsonSort: 'asc', jsonIndent: 'minify' },
    { id: 'c', op: 'json-minify' },
    { id: 'z', op: 'json-stringify', stringifyMinify: true, stringifyQuotes: true },
  ]));
}
const renderTab = () => render(<AppConfigProvider><LocaleProvider><PipelineTab active /></LocaleProvider></AppConfigProvider>);

beforeEach(() => { storageRemove(STEPS); storageRemove(COLLAPSED); });
afterEach(() => cleanup());

describe('Pipeline — collapse to the first step and the result', () => {
  it('keeps the first step and the Final Result; every later step folds into one bar', async () => {
    seed();
    renderTab();
    await waitFor(() => expect(screen.getAllByText(RESULT).length).toBeGreaterThan(1)); // last step + Final Result
    expect(screen.getByText('4 steps')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Collapse to first step and result/ }));
    const bar = screen.getByRole('button', { name: /3 steps hidden/ });
    expect(bar.textContent).toMatch(/2Sort Keys.*3JSON Minify.*4JSON → String/);
    // The last step's card (its options and output) is folded too…
    expect(screen.queryByRole('button', { name: 'Keep quotes' })).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Order' })).toBeNull();
    // …while the first step stays editable and the Final Result stays.
    expect(screen.getByDisplayValue('{"b":1,"a":2}')).toBeTruthy();
    expect(screen.getByText('Final Result')).toBeTruthy();
    expect(screen.getAllByText(RESULT)).toHaveLength(1);
    expect(JSON.parse(storageGet(COLLAPSED)!)).toBe(true);

    fireEvent.click(bar);
    expect(screen.queryByRole('button', { name: /steps hidden/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Keep quotes' })).toBeTruthy();
  });

  it('a failing hidden step turns the bar red', async () => {
    storageSet(COLLAPSED, 'true');
    storageSet(STEPS, JSON.stringify([
      { id: 'a', op: 'text-sunk', textValue: 'not json' },
      { id: 'b', op: 'json-minify' },
      { id: 'z', op: 'trim' },
    ]));
    renderTab();
    await waitFor(() => expect(screen.getByRole('button', { name: /2 steps hidden · 1 failed/ })).toBeTruthy());
  });

  it('works from two steps; a single step has nothing to collapse', () => {
    storageSet(COLLAPSED, 'true');
    storageSet(STEPS, JSON.stringify([{ id: 'a', op: 'text-sunk', textValue: 'x' }, { id: 'z', op: 'uppercase' }]));
    renderTab();
    expect(screen.getByRole('button', { name: /1 step hidden/ })).toBeTruthy();
    cleanup();
    storageSet(STEPS, JSON.stringify([{ id: 'a', op: 'text-sunk', textValue: 'x' }]));
    renderTab();
    expect(screen.queryByRole('button', { name: /Collapse to first step and result|Show all steps/ })).toBeNull();
  });

  it('adding a step while collapsed expands, so the new step is in view', () => {
    storageSet(COLLAPSED, 'true');
    seed();
    renderTab();
    fireEvent.click(screen.getAllByRole('button', { name: /Add a step/ }).at(-1)!);
    fireEvent.click(screen.getByRole('button', { name: 'Uppercase' }));
    expect(screen.queryByRole('button', { name: /steps hidden/ })).toBeNull();
    expect(JSON.parse(storageGet(COLLAPSED)!)).toBe(false);
  });
});
