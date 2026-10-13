import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { JsonFormatter } from '@/components/tools/JsonFormatter';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { storageRemove, storageSet } from '@/lib/persistentStore';

/** Status bar: "Valid JSON" only for strict JSON; lenient input gets a warning. */

const INPUT_KEY = 'devtool:json:json:input';

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

describe('JSON status', () => {
  it('calls strict JSON valid', () => {
    renderWith('{"name": "Ada", "tags": ["x"]}');
    expect(screen.getByText(/^Valid JSON$|^JSON hợp lệ$/)).toBeTruthy();
  });

  it('does not call lenient input valid (trailing comma, unquoted key)', () => {
    renderWith('{"name": "Ada", "tags": ["x",], age: 3}');
    expect(screen.queryByText(/^Valid JSON$|^JSON hợp lệ$/)).toBeNull();
    expect(screen.getByText(/Not strict JSON|Không phải JSON chuẩn/)).toBeTruthy();
    // Still parsed: the tree is there.
    expect(screen.getByRole('tree')).toBeTruthy();
  });

  it('a JSON-encoded string of JSON is strict', () => {
    renderWith(JSON.stringify('{"a":1}'));
    expect(screen.getByText(/^Valid JSON$|^JSON hợp lệ$/)).toBeTruthy();
  });
});
