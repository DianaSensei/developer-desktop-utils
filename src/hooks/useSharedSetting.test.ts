import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { storageGet, storageRemove } from '@/lib/persistentStore';
import { useMcpBackgroundBridge } from './useMcpBackgroundBridge';
import { useMcpToolEnabledMap } from './useMcpToolEnabled';

/** The MCP switches are read in several places at once (Settings, the setup
 *  dialog, each tool's bridge, the MCP management tools); a change from any
 *  one must reach the others without a restart. */

afterEach(() => {
  storageRemove('devtool-mcp-background-bridge');
  storageRemove('devtool-mcp-tool-enabled');
});

describe('MCP switches are shared', () => {
  it('background bridge: a change in one reader reaches the others', () => {
    const a = renderHook(() => useMcpBackgroundBridge());
    const b = renderHook(() => useMcpBackgroundBridge());
    act(() => a.result.current.setEnabled(true));
    expect(b.result.current.enabled).toBe(true);
    expect(storageGet('devtool-mcp-background-bridge')).toBe('true');
  });

  it('per-tool access: changes from two places merge instead of overwriting', () => {
    const mcp = renderHook(() => useMcpToolEnabledMap());
    const settings = renderHook(() => useMcpToolEnabledMap());
    act(() => mcp.result.current.setToolEnabled('base64', false));
    expect(settings.result.current.isEnabled('base64')).toBe(false);
    act(() => settings.result.current.setToolEnabled('jwt', false));
    expect(JSON.parse(storageGet('devtool-mcp-tool-enabled')!)).toEqual({ base64: false, jwt: false });
    expect(mcp.result.current.isEnabled('jwt')).toBe(false);
  });
});
