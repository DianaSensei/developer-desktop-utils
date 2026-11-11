import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { LARGE_PASTE_CHARS, Textarea } from './textarea';

function Field({ initial = '', onValue }: { initial?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <Textarea
      aria-label="field"
      value={value}
      onChange={(e) => { setValue(e.target.value); onValue?.(e.target.value); }}
    />
  );
}

const paste = (el: HTMLElement, text: string) =>
  fireEvent.paste(el, { clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') } });

describe('Textarea large paste', () => {
  it('leaves an ordinary paste to the browser', () => {
    const onValue = vi.fn();
    render(<Field onValue={onValue} />);
    // fireEvent returns false when the event was cancelled.
    expect(paste(screen.getByLabelText('field'), 'small')).toBe(true);
    expect(onValue).not.toHaveBeenCalled();
  });

  it('applies a large paste as a value change, replacing the selection', () => {
    const onValue = vi.fn();
    render(<Field initial="ab[XX]cd" onValue={onValue} />);
    const el = screen.getByLabelText('field') as HTMLTextAreaElement;
    el.setSelectionRange(2, 6);
    const big = 'x'.repeat(LARGE_PASTE_CHARS);

    expect(paste(el, big)).toBe(false);
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(el.value).toBe(`ab${big}cd`);
    expect(el.selectionStart).toBe(2 + big.length);
  });

  it('does not touch a read-only field', () => {
    render(<Textarea aria-label="out" readOnly value="keep" onChange={() => {}} />);
    const el = screen.getByLabelText('out') as HTMLTextAreaElement;
    expect(paste(el, 'x'.repeat(LARGE_PASTE_CHARS))).toBe(true);
    expect(el.value).toBe('keep');
  });

  it('still calls the caller\'s onPaste, and respects its preventDefault', () => {
    const onChange = vi.fn();
    render(<Textarea aria-label="own" value="" onChange={onChange} onPaste={(e) => e.preventDefault()} />);
    paste(screen.getByLabelText('own'), 'x'.repeat(LARGE_PASTE_CHARS));
    expect(onChange).not.toHaveBeenCalled();
  });
});
