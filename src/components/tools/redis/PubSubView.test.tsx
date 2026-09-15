import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PubSubView } from './PubSubView';
import type { RedisConnection } from './types';

/**
 * `PubSubView` no longer builds a `Channel<PubSubMessage>` itself (Phase 2,
 * Bước 4/5 — see docs/decisions/architecture/platform-plugin-architecture.md) — it hands
 * an `onMessage` callback straight to `redisApi.pubsubSubscribe`, and stores
 * the returned `{ stop() }` object in a ref instead of a raw subscription id
 * string. These tests mock `useRedisApi` (the one seam this view goes
 * through) so they only need to cover the WIRING this file owns: passing the
 * onMessage callback through, calling `.stop()` on unmount/Stop click, and
 * the loading/error/success states around `subscribe()`.
 */

const pubsubSubscribeMock = vi.fn();
const publishMock = vi.fn();

vi.mock('./api', () => ({
  useRedisApi: () => ({
    pubsubSubscribe: (...a: unknown[]) => pubsubSubscribeMock(...a),
    publish: (...a: unknown[]) => publishMock(...a),
  }),
}));

function makeConn(): RedisConnection {
  return { id: 'c1', name: 'Local', host: 'localhost', port: 6379, username: null, password: null, useTls: false };
}

afterEach(() => {
  cleanup();
  pubsubSubscribeMock.mockReset();
  publishMock.mockReset();
});

describe('PubSubView', () => {
  it('empty state: prompts to subscribe before any subscription exists', () => {
    render(<PubSubView conn={makeConn()} />);
    expect(screen.getByText(/Subscribe to a channel or pattern/)).toBeTruthy();
  });

  it('error state: rejects subscribing with neither a channel nor a pattern', async () => {
    render(<PubSubView conn={makeConn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Subscribe/ }));
    expect(await screen.findByText(/Provide at least one channel or pattern/)).toBeTruthy();
    expect(pubsubSubscribeMock).not.toHaveBeenCalled();
  });

  it('error state: shows the rejection message if pubsubSubscribe fails', async () => {
    pubsubSubscribeMock.mockRejectedValue(new Error('connection refused'));
    render(<PubSubView conn={makeConn()} />);
    fireEvent.change(screen.getByPlaceholderText('news, alerts'), { target: { value: 'news' } });
    fireEvent.click(screen.getByRole('button', { name: /Subscribe/ }));
    expect(await screen.findByText('connection refused')).toBeTruthy();
  });

  it('success state: subscribes, forwards streamed messages to the list, and Stop calls sub.stop()', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    let onMessage: ((msg: { channel: string; pattern: string | null; payload: string }) => void) | undefined;
    pubsubSubscribeMock.mockImplementation((_configId, _channels, _patterns, cb) => {
      onMessage = cb;
      return Promise.resolve({ stop });
    });

    render(<PubSubView conn={makeConn()} />);
    fireEvent.change(screen.getByPlaceholderText('news, alerts'), { target: { value: 'news' } });
    fireEvent.click(screen.getByRole('button', { name: /Subscribe/ }));

    await waitFor(() => expect(pubsubSubscribeMock).toHaveBeenCalledWith('c1', ['news'], [], expect.any(Function)));
    expect(await screen.findByRole('button', { name: /Stop/ })).toBeTruthy();

    onMessage!({ channel: 'news', pattern: null, payload: 'hello world' });
    expect(await screen.findByText('hello world')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    // Back to the "not subscribed" form — Subscribe button visible again,
    // Stop gone. Received messages are intentionally NOT cleared by Stop.
    expect(screen.getByRole('button', { name: /Subscribe/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
  });

  it('calls sub.stop() on unmount so a leftover subscription does not keep running', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    pubsubSubscribeMock.mockResolvedValue({ stop });

    const { unmount } = render(<PubSubView conn={makeConn()} />);
    fireEvent.change(screen.getByPlaceholderText('news, alerts'), { target: { value: 'news' } });
    fireEvent.click(screen.getByRole('button', { name: /Subscribe/ }));
    await waitFor(() => expect(pubsubSubscribeMock).toHaveBeenCalled());
    await screen.findByRole('button', { name: /Stop/ });

    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
