import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { JsonFormatter } from '@/components/tools/JsonFormatter';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { storageRemove, storageSet } from '@/lib/persistentStore';

/**
 * Cây JSON: windowing (file lớn không vẽ hết), điều hướng bằng bàn phím theo
 * mẫu tree của ARIA, và đếm/nhảy kết quả tìm kiếm.
 */

const INPUT_KEY = 'devtool:json:json:input';
const big = JSON.stringify(Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`key${i}`, i])));

function renderWith(json: string) {
  storageSet(INPUT_KEY, JSON.stringify(json));
  return render(
    <AppConfigProvider>
      <JsonFormatter />
    </AppConfigProvider>,
  );
}

beforeEach(() => storageRemove(INPUT_KEY));
afterEach(() => cleanup());

describe('JSON tree', () => {
  it('renders only a window of a 5000-key document, not every line', () => {
    renderWith(big);
    const items = screen.getAllByRole('treeitem');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(200);
  });

  it('arrow keys move the selection; ← on an open node collapses it', () => {
    renderWith('{"a":{"b":1},"c":2}');
    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(screen.getAllByRole('treeitem')[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tree, { key: 'ArrowDown' }); // → "a": {
    const a = screen.getAllByRole('treeitem')[1];
    expect(a.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    expect(screen.getAllByRole('treeitem')[1].getAttribute('aria-expanded')).toBe('false');
  });

  it('counts matches and Enter in the search box jumps between them', () => {
    renderWith('{"name":"x","nested":{"name":"y"}}');
    const search = screen.getByPlaceholderText(/find by key/i);
    fireEvent.change(search, { target: { value: 'name' } });
    expect(screen.getByText('1/2')).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByText('2/2')).toBeTruthy();
  });
});
