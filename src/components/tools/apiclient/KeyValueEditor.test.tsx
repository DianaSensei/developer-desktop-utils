// Covers the parts of the Name/Value table that are behaviour rather than
// styling: the Resolved column (what a {{token}} is actually worth right
// now), the row filter that appears once a table gets long, and the bulk-edit
// round trip.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { KeyValueEditor } from './KeyValueEditor';
import { newKeyValue } from './types';
import type { KeyValue } from './types';

const row = (key: string, value: string, over: Partial<KeyValue> = {}): KeyValue => ({
  ...newKeyValue(key, value),
  enabled: true,
  ...over,
});

const vars = { baseUrl: 'https://api.test', userId: '42', token: 'abc123' };

/** The table's header cells, in order — the column set under test. */
const headers = () =>
  Array.from(document.querySelectorAll('.uppercase > div'))
    .map((el) => el.textContent?.trim())
    .filter(Boolean);

describe('KeyValueEditor — Resolved column', () => {
  it('is absent when no row uses a {{token}}', () => {
    render(<KeyValueEditor rows={[row('page', '1')]} onChange={() => {}} vars={vars} />);
    expect(headers()).toEqual(['Name', 'Value']);
  });

  it('is absent entirely when the editor has no variables to resolve against', () => {
    render(<KeyValueEditor rows={[row('page', '{{userId}}')]} onChange={() => {}} />);
    expect(headers()).toEqual(['Name', 'Value']);
  });

  it('appears once a row uses a token, and shows the current value', () => {
    render(<KeyValueEditor rows={[row('user', '{{userId}}')]} onChange={() => {}} vars={vars} />);
    expect(headers()).toEqual(['Name', 'Value', 'Resolved']);
    // The whole point: the value is readable without hovering the token.
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('resolves a value that mixes literal text with several tokens', () => {
    render(<KeyValueEditor rows={[row('url', '{{baseUrl}}/users/{{userId}}')]} onChange={() => {}} vars={vars} />);
    expect(screen.getByText('https://api.test/users/42')).toBeTruthy();
  });

  it('calls out a token nothing defines, since it is sent literally', () => {
    render(<KeyValueEditor rows={[row('user', '{{nope}}')]} onChange={() => {}} vars={vars} />);
    const cell = screen.getByText('{{nope}} undefined');
    expect(cell.className).toContain('text-bad');
    expect(cell.getAttribute('title')).toContain('sent literally');
  });

  it('leaves the cell blank for rows without tokens while others have them', () => {
    render(
      <KeyValueEditor
        rows={[row('user', '{{userId}}'), row('page', '1')]}
        onChange={() => {}}
        vars={vars}
      />,
    );
    // The resolved cell carries its full text as a title; the literal row
    // contributes none, so its value isn't echoed a column over.
    expect(screen.getByTitle('42')).toBeTruthy();
    expect(screen.queryByTitle('1')).toBeNull();
  });

  it('shows only the mask for a secret, never the underlying value', () => {
    render(
      <KeyValueEditor
        rows={[row('auth', 'Bearer {{vault.key}}')]}
        onChange={() => {}}
        vars={{ 'vault.key': '••••••••' }}
      />,
    );
    expect(screen.getByText('Bearer ••••••••')).toBeTruthy();
  });
});

describe('KeyValueEditor — filter for long tables', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => row(`field${i}`, `value${i}`));

  it('stays out of the way for a short table', () => {
    render(<KeyValueEditor rows={many(3)} onChange={() => {}} />);
    expect(screen.queryByRole('textbox', { name: 'Filter rows' })).toBeNull();
  });

  it('appears once the table is long enough to be worth searching', () => {
    render(<KeyValueEditor rows={many(10)} onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Filter rows' })).toBeTruthy();
    expect(screen.getByText('10 rows')).toBeTruthy();
  });

  // The rows actually rendered, read off the Name inputs — the filter box is
  // itself a text input, so a document-wide display-value query would match it.
  const renderedNames = () =>
    screen.getAllByPlaceholderText('Name').map((el) => (el as HTMLInputElement).value);

  it('narrows the rendered rows and reports how many matched', () => {
    render(<KeyValueEditor rows={many(10)} onChange={() => {}} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter rows' }), { target: { value: 'field7' } });

    expect(screen.getByText('1/10')).toBeTruthy();
    // The match plus the trailing ghost row, which filtering never hides.
    expect(renderedNames()).toEqual(['field7', '']);
  });

  it('never drops the hidden rows from the data — editing while filtered keeps them', () => {
    const onChange = vi.fn();
    render(<KeyValueEditor rows={many(10)} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter rows' }), { target: { value: 'field7' } });
    fireEvent.change(screen.getAllByPlaceholderText('Value')[0], { target: { value: 'edited' } });

    const next = onChange.mock.calls[0][0] as KeyValue[];
    expect(next).toHaveLength(10);
    expect(next.find((r) => r.key === 'field7')?.value).toBe('edited');
    expect(next.find((r) => r.key === 'field3')?.value).toBe('value3');
  });
});

describe('KeyValueEditor — bulk edit', () => {
  it('round-trips rows through the textarea, keeping disabled ones marked', () => {
    const rows = [row('a', '1'), row('b', '2', { enabled: false })];
    render(<KeyValueEditor rows={rows} onChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Bulk Edit' }));
    // The editor is CodeMirror, so assert on the document it rendered.
    const surface = document.querySelector('.cm-content');
    expect(surface?.textContent).toContain('a:1');
    expect(surface?.textContent).toContain('//b:2');
  });

  it('explains the line format instead of leaving it to be guessed', () => {
    render(<KeyValueEditor rows={[row('a', '1')]} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bulk Edit' }));

    const hint = screen.getByText(/per line/);
    expect(within(hint).getByText('//')).toBeTruthy();
  });
});

describe('KeyValueEditor — empty filter result', () => {
  it('says why the table is empty rather than showing a bare ghost row', () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(`field${i}`, `value${i}`));
    render(<KeyValueEditor rows={rows} onChange={() => {}} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter rows' }), { target: { value: 'nothing-matches' } });

    expect(screen.getByText(/No rows match/)).toBeTruthy();
    expect(screen.getByText(/9 hidden/)).toBeTruthy();
  });
});
