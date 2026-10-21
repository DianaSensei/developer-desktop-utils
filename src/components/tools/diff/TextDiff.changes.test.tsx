import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TextDiff } from '@/components/tools/diff/TextDiff';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { storageRemove, storageSet } from '@/lib/persistentStore';

// jsdom has no layout; CodeMirror's scrollIntoView measures ranges.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

const KEYS = ['mode', 'text1', 'text2'].map((k) => `devtool:diff:diff:${k}`);

afterEach(() => {
  cleanup();
  for (const k of KEYS) storageRemove(k);
});

describe('Diff — exact changes panel', () => {
  it('lists the changed characters with line:column and selects them on click', async () => {
    storageSet('devtool:diff:diff:mode', JSON.stringify('text'));
    storageSet('devtool:diff:diff:text1', JSON.stringify('alpha\nthe quick fox\nomega'));
    storageSet('devtool:diff:diff:text2', JSON.stringify('alpha\nthe slow fox\nomega'));
    render(<AppConfigProvider><LocaleProvider><TextDiff /></LocaleProvider></AppConfigProvider>);

    const row = await waitFor(() => screen.getByTitle('Select this change in both panes'));
    expect(row.textContent).toContain('2:5');
    expect(row.textContent).toContain('quick');
    expect(row.textContent).toContain('slow');
    fireEvent.click(row);
    // The change is selected in the modified pane, which takes focus.
    await waitFor(() => expect(document.activeElement?.closest('.cm-merge-b')).toBeTruthy());
  });
});
