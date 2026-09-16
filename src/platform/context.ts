import { createContext, createElement, useContext, type ComponentType, type ReactNode } from 'react';
import type { PluginSdk } from './sdk';

/**
 * Danh tính + SDK của plugin đang được render.
 *
 * Registry bọc component của mỗi plugin bằng provider này, nên bên trong plugin
 * chỉ cần `usePluginSdk()` là có đúng SDK của CHÍNH nó — không truyền id qua
 * props, và cũng không có cách nào cầm nhầm SDK của plugin khác.
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

/** SDK khi có, `null` khi đang ở phần shell của app — không ném. */
export function usePluginSdkOptional(): PluginSdk | null {
  return useContext(PluginContext);
}

/** Bọc component gốc của plugin bằng provider. Gọi một lần lúc dựng registry. */
export function withPluginSdk(sdk: PluginSdk, Component: ComponentType): ComponentType {
  const Wrapped = (props: Record<string, unknown>) =>
    createElement(PluginProvider, { sdk, children: createElement(Component, props) });
  Wrapped.displayName = `PluginHost(${sdk.id})`;
  return Wrapped as ComponentType;
}
