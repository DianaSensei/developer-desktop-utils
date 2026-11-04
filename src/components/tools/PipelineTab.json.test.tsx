import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PipelineTab } from '@/components/tools/PipelineTab';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { storageRemove, storageSet } from '@/lib/persistentStore';

const STEPS = 'devtool:base64:pipeline:steps-v2';

beforeEach(() => storageRemove(STEPS));
afterEach(() => cleanup());

describe('Pipeline — JSON steps', () => {
  it('the add-step menu has a JSON group with every JSON step', () => {
    render(<AppConfigProvider><LocaleProvider><PipelineTab active /></LocaleProvider></AppConfigProvider>);
    fireEvent.click(screen.getAllByRole('button', { name: /Add a step/ }).at(-1)!);
    expect(screen.getByText('JSON', { selector: 'p' })).toBeTruthy();
    for (const label of ['JSON Format', 'JSON Minify', 'JSON → String', 'String → JSON', 'Sort Keys', 'JSON → YAML', 'YAML → JSON']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('chains Text → JSON Minify → JSON → String into the final result', async () => {
    storageSet(STEPS, JSON.stringify([
      { id: 'a', op: 'text-sunk', textValue: '{ "a": 1,\n  "b": [true] }' },
      { id: 'b', op: 'json-minify' },
      { id: 'c', op: 'json-stringify', stringifyMinify: true, stringifyQuotes: true },
    ]));
    render(<AppConfigProvider><LocaleProvider><PipelineTab active /></LocaleProvider></AppConfigProvider>);
    await waitFor(() => expect(screen.getAllByText('"{\\"a\\":1,\\"b\\":[true]}"').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: 'Keep quotes', pressed: true })).toBeTruthy();
  });
});
