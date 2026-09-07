// Form-data rows are {{var}}-substituted on send (request.ts's multipart
// branch), so this editor carries the same Resolved column as the other
// tables. These cover that, plus the row behaviour the column sits on top of.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MultipartEditor } from './MultipartEditor';
import { newKeyValue } from './types';
import type { KeyValue } from './types';

const row = (key: string, value: string, over: Partial<KeyValue> = {}): KeyValue => ({
  ...newKeyValue(key, value),
  enabled: true,
  ...over,
});

const vars = { userId: '42', baseUrl: 'https://api.test' };

const headers = () =>
  Array.from(document.querySelectorAll('.uppercase > div'))
    .map((el) => el.textContent?.trim())
    .filter(Boolean);

describe('MultipartEditor — Resolved column', () => {
  it('keeps the original column set when nothing uses a token', () => {
    render(<MultipartEditor rows={[row('name', 'literal')]} onChange={() => {}} vars={vars} />);
    expect(headers()).toEqual(['Name', 'Value', 'Content-Type']);
  });

  it('stays absent when the editor is given no variables at all', () => {
    render(<MultipartEditor rows={[row('user', '{{userId}}')]} onChange={() => {}} />);
    expect(headers()).toEqual(['Name', 'Value', 'Content-Type']);
  });

  it('shows what a token is worth, between Value and Content-Type', () => {
    render(<MultipartEditor rows={[row('user', '{{userId}}')]} onChange={() => {}} vars={vars} />);
    expect(headers()).toEqual(['Name', 'Value', 'Resolved', 'Content-Type']);
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('calls out a token nothing defines', () => {
    render(<MultipartEditor rows={[row('user', '{{nope}}')]} onChange={() => {}} vars={vars} />);
    const cell = screen.getByText('{{nope}} undefined');
    expect(cell.className).toContain('text-bad');
  });

  it('leaves a file row out of the resolved column — its value is the bytes, not text', () => {
    render(
      <MultipartEditor
        rows={[
          row('avatar', '', { kind: 'file', fileName: 'me.png', fileType: 'image/png', fileContent: 'AAA' }),
          row('user', '{{userId}}'),
        ]}
        onChange={() => {}}
        vars={vars}
      />,
    );
    expect(screen.getByText('me.png')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });
});

describe('MultipartEditor — rows', () => {
  it('materializes the trailing ghost row on first edit', () => {
    const onChange = vi.fn();
    render(<MultipartEditor rows={[]} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'field' } });

    const next = onChange.mock.calls[0][0] as KeyValue[];
    expect(next).toHaveLength(1);
    expect(next[0].key).toBe('field');
  });

  it('toggles a row without touching its value', () => {
    const onChange = vi.fn();
    render(<MultipartEditor rows={[row('a', '1')]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /a — enabled/ }));

    const next = onChange.mock.calls[0][0] as KeyValue[];
    expect(next[0]).toMatchObject({ key: 'a', value: '1', enabled: false });
  });

  it('drops a file back to a text row when the file is removed', () => {
    const onChange = vi.fn();
    render(
      <MultipartEditor
        rows={[row('avatar', '', { kind: 'file', fileName: 'me.png', fileContent: 'AAA' })]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTitle('Remove file'));

    const next = onChange.mock.calls[0][0] as KeyValue[];
    expect(next[0]).toMatchObject({ kind: 'text', fileName: undefined, fileContent: undefined });
  });
});
