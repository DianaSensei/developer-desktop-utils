import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RuntimeVarsInspector } from './RuntimeVarsInspector';

// Regression coverage for the "a stuck bru.setVar value never goes away"
// report: runtime vars win over every other tier and previously had no way
// to clear one short of restarting the app. These test the UI wiring only —
// engine.test.ts covers the underlying script -> runtimeVars mechanism.
describe('RuntimeVarsInspector', () => {
  it('lists every runtime variable, sorted by name', () => {
    render(
      <RuntimeVarsInspector
        vars={{ zeta: '1', alpha: '2' }}
        open
        onClose={() => {}}
        onClear={() => {}}
        onDeleteVar={() => {}}
      />,
    );
    const names = screen.getAllByRole('cell').filter((_, i) => i % 3 === 0).map((c) => c.textContent);
    expect(names).toEqual(['alpha', 'zeta']);
  });

  it('calls onClear when "Clear all runtime variables" is clicked', () => {
    const onClear = vi.fn();
    render(
      <RuntimeVarsInspector
        vars={{ sticky: 'old-value' }}
        open
        onClose={() => {}}
        onClear={onClear}
        onDeleteVar={() => {}}
      />,
    );
    fireEvent.click(screen.getByTitle('Clear all runtime variables'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('disables "Clear all" when there are no runtime variables', () => {
    render(
      <RuntimeVarsInspector vars={{}} open onClose={() => {}} onClear={() => {}} onDeleteVar={() => {}} />,
    );
    expect((screen.getByTitle('Clear all runtime variables') as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls onDeleteVar with just that row\'s key when its own clear button is clicked', () => {
    const onDeleteVar = vi.fn();
    render(
      <RuntimeVarsInspector
        vars={{ sticky: 'old-value', other: 'x' }}
        open
        onClose={() => {}}
        onClear={() => {}}
        onDeleteVar={onDeleteVar}
      />,
    );
    fireEvent.click(screen.getByTitle('Clear sticky'));
    expect(onDeleteVar).toHaveBeenCalledExactlyOnceWith('sticky');
  });

  it('shows the empty state, not the table, when there are no runtime variables', () => {
    render(
      <RuntimeVarsInspector vars={{}} open onClose={() => {}} onClear={() => {}} onDeleteVar={() => {}} />,
    );
    expect(screen.getByText(/No runtime variables set yet/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
