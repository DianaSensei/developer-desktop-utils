import { lazy, type ComponentType } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { PLUGINS } from '@/platform';

/**
 * App routes, derived from the plugin registry. Settings is appended here:
 * it is part of the shell, always enabled, and never in the tool list.
 */
const Settings = lazy(() => import('@/components/Settings').then((m) => ({ default: m.Settings })));

export const TOOL_ROUTES: Record<string, { path: string; component: ComponentType; fullHeight?: boolean }> =
  Object.fromEntries(
    PLUGINS.map((p) => [p.id, { path: p.route, component: p.component, fullHeight: p.fullHeight }]),
  );

export const allTools = [
  ...PLUGINS.map((p) => ({
    featureId: p.id,
    label: p.label,
    icon: p.icon,
    description: p.description,
    keywords: p.keywords,
    experimental: p.experimental,
    path: p.route,
    component: p.component,
    fullHeight: p.fullHeight,
  })),
  // Settings manages its own two-column layout, each column scrolling.
  { featureId: 'settings', label: 'Settings', icon: SettingsIcon, description: '', keywords: [], experimental: false, path: '/settings', component: Settings as ComponentType, fullHeight: true },
];

/** Tool id → route path, including 'settings' (not in TOOL_DEFS). */
export const TOOL_PATHS = new Map(allTools.map((t) => [t.featureId, t.path]));

export function toolPath(id: string): string {
  return TOOL_PATHS.get(id) ?? '/';
}
