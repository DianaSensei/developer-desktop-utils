import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SearchInput } from '@/components/ui/search-input';

/**
 * None of SearchInput's ~20 call sites pairs it with a visible <Label> — the
 * magnifier plus the placeholder is the whole affordance — so the component
 * itself has to carry the accessible name.
 */

afterEach(cleanup);

describe('SearchInput', () => {
  it('names itself from its placeholder', () => {
    render(<SearchInput value="" onChange={() => {}} placeholder="Search exchanges…" />);
    expect(screen.getByRole('textbox', { name: 'Search exchanges…' })).toBeTruthy();
  });

  it('falls back to a default name when no placeholder is given', () => {
    render(<SearchInput value="" onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeTruthy();
  });

  it('lets a call site override the name', () => {
    render(<SearchInput value="" onChange={() => {}} placeholder="Filter…" aria-label="Filter topics" />);
    expect(screen.getByRole('textbox', { name: 'Filter topics' })).toBeTruthy();
  });

  it('shows a named clear button only when there is something to clear', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SearchInput value="" onChange={onChange} />);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();

    rerender(<SearchInput value="redis" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('stays a text input so the browser does not draw its own clear button next to ours', () => {
    render(<SearchInput value="x" onChange={() => {}} />);
    expect(screen.getByRole('textbox').getAttribute('type')).toBe('text');
  });
});
