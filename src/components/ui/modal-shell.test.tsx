import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ModalShell } from '@/components/ui/modal-shell';

/**
 * Every one of these assertions corresponds to something a hand-rolled copy of
 * this modal was missing: the broker connection forms and info modals each
 * portalled a bare <div> with an unlabelled `<X>`, no dialog role, no name, and
 * no Escape handling.
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

  it('gives the close button an accessible name', () => {
    const { onClose } = renderShell();
    const close = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const { onClose } = renderShell();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a backdrop press but not on one that starts inside the panel', () => {
    const { onClose } = renderShell();
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement!;

    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
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
