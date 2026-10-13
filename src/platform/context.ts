import { createContext, createElement, useContext, type ComponentType, type ReactNode } from 'react';
import type { PluginSdk } from './sdk';

/**
 * The SDK of the plugin being rendered. The registry wraps each plugin in
 * this provider, so `usePluginSdk()` always returns the plugin's own SDK.
 */
const PluginContext = createContext<PluginSdk | null>(null);

export function PluginProvider({ sdk, children }: { sdk: PluginSdk; children: ReactNode }) {
  return createElement(PluginContext.Provider, { value: sdk }, children);
}

export function usePluginSdk(): PluginSdk {
  const sdk = useContext(PluginContext);
  if (!sdk) {
    throw new Error(
      'usePluginSdk() gọi ngoài cây của một plugin. Chỉ component do Platform dựng ' +
        '(qua manifest.load) mới có SDK; code dùng chung nên nhận SDK qua props.',
    );
  }
  return sdk;
}

/** The SDK, or `null` in the app shell. Does not throw. */
export function usePluginSdkOptional(): PluginSdk | null {
  return useContext(PluginContext);
}

/** Wraps a plugin's root component in the provider. */
export function withPluginSdk(sdk: PluginSdk, Component: ComponentType): ComponentType {
  const Wrapped = (props: Record<string, unknown>) =>
    createElement(PluginProvider, { sdk, children: createElement(Component, props) });
  Wrapped.displayName = `PluginHost(${sdk.id})`;
  return Wrapped as ComponentType;
}
