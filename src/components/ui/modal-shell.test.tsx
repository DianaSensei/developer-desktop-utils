import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ModalShell } from '@/components/ui/modal-shell';

/**
 * Each assertion covers something hand-rolled modals lacked: dialog role,
 * accessible name, labelled close button, Escape handling.
 */

afterEach(cleanup);

function renderShell(props: Partial<React.ComponentProps<typeof ModalShell>> = {}) {
  const onClose = vi.fn();
  render(
    <ModalShell onClose={onClose} title="Add Connection" {...props}>
      <input aria-label="Host" />
      <button type="button">Save</button>
    </ModalShell>,
  );
  return { onClose };
}

describe('ModalShell', () => {
  it('exposes a named modal dialog', () => {
    renderShell();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toBe('Add Connection');
  });

  it('describes itself from the optional description', () => {
    renderShell({ description: 'Point the tool at a broker.' });
    const dialog = screen.getByRole('dialog');
    const descId = dialog.getAttribute('aria-describedby');
    expect(descId).toBeTruthy();
    expect(document.getElementById(descId!)?.textContent).toBe('Point the tool at a broker.');

    cleanup();
    renderShell();
    expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBeNull();
  });

  // `onClose` runs 130ms (`--dur-exit`) after each close path, so these
  // tests wait past that delay.
  it('gives the close button an accessible name, and closes after the exit animation', () => {
    vi.useFakeTimers();
    const { onClose } = renderShell();
    const close = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(close);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(130);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('closes on Escape, after the exit animation', () => {
    vi.useFakeTimers();
    const { onClose } = renderShell();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    vi.advanceTimersByTime(130);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('closes on a backdrop press but not on one that starts inside the panel', () => {
    vi.useFakeTimers();
    const { onClose } = renderShell();
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement!;

    fireEvent.mouseDown(dialog);
    vi.advanceTimersByTime(130);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(backdrop);
    vi.advanceTimersByTime(130);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('plays the exit animation instead of vanishing in one frame, and ignores a second close request mid-exit', () => {
    // `onClose` used to run immediately, so the parent removed the panel
    // before its exit animation.
    vi.useFakeTimers();
    const { onClose } = renderShell();
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    // Still in the DOM right after closing; the exit animation needs time.
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(dialog.className).toContain('animate-out');
    expect(onClose).not.toHaveBeenCalled();

    // A second close during the exit must not queue another `onClose`.
    fireEvent.keyDown(dialog, { key: 'Escape' });

    vi.advanceTimersByTime(130);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('moves focus onto the panel on open rather than into a field', () => {
    renderShell();
    // Landing on the panel, not the first input, keeps the modal from swallowing
    // keystrokes into a field the user never picked.
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('wraps Tab at the ends instead of letting focus escape the panel', () => {
    renderShell();
    const dialog = screen.getByRole('dialog');
    const host = screen.getByLabelText('Host');
    const close = screen.getByRole('button', { name: 'Close' });
    const save = screen.getByRole('button', { name: 'Save' });

    // Header close button first in DOM order, Save last.
    save.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(close);

    close.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);

    // A Tab in the middle of the list is left to the browser.
    host.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(host);
  });

  it('restores focus to the previously focused element on unmount', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(
      <ModalShell onClose={() => {}} title="Add Connection">
        <input aria-label="Host" />
      </ModalShell>,
    );
    expect(document.activeElement).not.toBe(opener);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('renders a footer only when one is given', () => {
    const { unmount } = render(
      <ModalShell onClose={() => {}} title="T"><p>body</p></ModalShell>,
    );
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull();
    unmount();

    render(
      <ModalShell onClose={() => {}} title="T" footer={<button type="button">Got it</button>}>
        <p>body</p>
      </ModalShell>,
    );
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy();
  });
});
