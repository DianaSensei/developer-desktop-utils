import { describe, expect, it } from 'vitest';
import { PLUGINS, PLUGIN_ERRORS, DEFAULT_PLUGIN_ORDER, DEFAULT_PLUGIN_FEATURES } from '@/platform';
import { TOOL_DEFS, DEFAULT_TOOL_ORDER } from '@/lib/toolDefs';
import { TOOL_ROUTES, allTools } from '@/lib/toolRegistry';

/**
 * The registry silently drops an invalid manifest, so a typo would remove a
 * tool from the sidebar without any error. These tests turn that into a CI
 * failure.
 *
 * The pinned tables record the expected tools, sidebar order, routes and
 * defaults. Update them deliberately when adding or removing a plugin.
 */

const PINNED_ORDER = [
  "task-tracker",
  "api-client",
  "mock-server",
  "json",
  "data-converter",
  "deduplicate",
  "text-transform",
  "sql-formatter",
  "unix-time",
  "generator",
  "base64",
  "text-counter",
  "regex",
  "diff",
  "cron-generator",
  "qrcode",
  "color-picker",
  "markdown",
  "lucky-wheel",
  "network",
  "2fa"
];

const PINNED_ROUTES: Record<string, string> = {
  "cron-generator": "/",
  "text-transform": "/text-transform",
  "text-counter": "/text-counter",
  "color-picker": "/color-picker",
  "base64": "/base64",
  "unix-time": "/unix-time",
  "json": "/json",
  "data-converter": "/data-converter",
  "regex": "/regex",
  "diff": "/diff",
  "qrcode": "/qrcode",
  "markdown": "/markdown",
  "deduplicate": "/deduplicate",
  "generator": "/generator",
  "sql-formatter": "/sql-formatter",
  "task-tracker": "/task-tracker",
  "network": "/network",
  "lucky-wheel": "/lucky-wheel",
  "api-client": "/api-client",
  "mock-server": "/mock-server",
  "2fa": "/2fa"
};

const PINNED_LABELS: Record<string, string> = {
  "cron-generator": "Cron Generator",
  "text-transform": "Text Transformer",
  "text-counter": "Text Counter",
  "color-picker": "Color Picker",
  "base64": "Encode·Hash·Encrypt",
  "unix-time": "Date / Time",
  "json": "JSON Formatter",
  "data-converter": "Data Converter",
  "regex": "Regex Tester",
  "diff": "Diff",
  "qrcode": "QR Code",
  "markdown": "Markdown",
  "deduplicate": "Deduplicate",
  "generator": "Generator",
  "sql-formatter": "SQL Formatter",
  "task-tracker": "Time Tracker",
  "network": "Network Tools",
  "lucky-wheel": "Lucky Wheel",
  "api-client": "API Client",
  "mock-server": "Mock Server",
  "2fa": "2FA Authenticator"
};

const PINNED_DEFAULT_ENABLED: Record<string, boolean> = {
  "task-tracker": true,
  "api-client": true,
  "mock-server": true,
  "cron-generator": true,
  "text-transform": true,
  "text-counter": true,
  "color-picker": false,
  "base64": true,
  "unix-time": true,
  "json": true,
  "data-converter": true,
  "regex": false,
  "diff": false,
  "qrcode": true,
  "markdown": false,
  "deduplicate": false,
  "generator": true,
  "sql-formatter": false,
  "network": false,
  "lucky-wheel": false,
  "2fa": true
};

describe('registry — tính toàn vẹn', () => {
  it('không manifest nào bị loại', () => {
    expect(PLUGIN_ERRORS).toEqual([]);
  });

  it('id là duy nhất', () => {
    const ids = PLUGINS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('route là duy nhất và tuyệt đối', () => {
    const paths = PLUGINS.map((p) => p.route);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of PLUGINS) expect(p.route.startsWith('/'), p.id).toBe(true);
  });

  it('order là duy nhất và đã sắp tăng dần', () => {
    const orders = PLUGINS.map((p) => p.order);
    expect(new Set(orders).size).toBe(orders.length);
    expect([...orders]).toEqual([...orders].sort((a, b) => a - b));
  });

  it('mọi plugin đều có component dựng được', () => {
    for (const p of PLUGINS) expect(p.component, p.id).toBeDefined();
  });

  it('quyền "native" luôn đi kèm allowlist lệnh, và ngược lại', () => {
    for (const p of PLUGINS) {
      expect(p.permissions.includes('native'), p.id).toBe(p.commands.length > 0);
    }
  });
});

describe('registry — không đổi hành vi so với bản đăng ký tay', () => {
  it('đúng tập plugin, đúng thứ tự sidebar mặc định', () => {
    expect(DEFAULT_PLUGIN_ORDER).toEqual(PINNED_ORDER);
    expect(DEFAULT_TOOL_ORDER).toEqual(PINNED_ORDER);
  });

  it('đúng route cho từng plugin', () => {
    for (const [id, path] of Object.entries(PINNED_ROUTES)) {
      expect(TOOL_ROUTES[id]?.path, id).toBe(path);
    }
    expect(Object.keys(TOOL_ROUTES).sort()).toEqual(Object.keys(PINNED_ROUTES).sort());
  });

  it('đúng nhãn hiển thị', () => {
    for (const [id, label] of Object.entries(PINNED_LABELS)) {
      expect(TOOL_DEFS.find((d) => d.id === id)?.label, id).toBe(label);
    }
  });

  it('đúng mặc định bật/tắt', () => {
    for (const [id, enabled] of Object.entries(PINNED_DEFAULT_ENABLED)) {
      expect(DEFAULT_PLUGIN_FEATURES[id], id).toBe(enabled);
    }
    expect(Object.keys(DEFAULT_PLUGIN_FEATURES).sort()).toEqual(
      Object.keys(PINNED_DEFAULT_ENABLED).sort(),
    );
  });

  it('allTools vẫn là mọi plugin cộng đúng một mục "settings" ở cuối', () => {
    expect(allTools).toHaveLength(PLUGINS.length + 1);
    expect(allTools.at(-1)?.featureId).toBe('settings');
  });
});
