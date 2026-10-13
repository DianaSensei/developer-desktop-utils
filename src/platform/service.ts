import * as audit from './audit';
import type { PluginManifest } from './types';

/**
 * Tier B: service plugins (sidecars).
 *
 * A plugin that needs what the webview cannot do (raw sockets, filesystem,
 * other ecosystems' SDKs) declares `service` in its manifest. The host runs
 * that binary as a separate process and the plugin calls it through
 * `sdk.service.call()`. See service_host.rs for why a process is used.
 *
 * This file is the client half: permission checks, audit, and message
 * framing. Frames carry `protocol` so mismatched host and client versions
 * fail clearly.
 */

/** Frame format version; bump when the frame shape changes. */
export const SERVICE_PROTOCOL = 1;

export interface ServiceDescriptor {
  /**
   * Sidecar binary name without extension or target triple.
   */
  bin: string;
  /** Methods this sidecar serves; other calls are blocked client-side. */
  methods: string[];
  /** Not honoured yet: the host applies a fixed 30s timeout (`CALL_TIMEOUT` in service_host.rs). */
  timeoutMs?: number;
}

export interface ServiceRequest {
  protocol: number;
  /** Call id, used to match responses on the shared channel. */
  id: string;
  plugin: string;
  /**
   * Binary to run. The host decides whether it may run (allowlist or user
   * consent in service_host.rs); the client only names it.
   */
  bin: string;
  method: string;
  params: unknown;
}

export interface ServiceResponse {
  protocol: number;
  id: string;
  result?: unknown;
  error?: string;
  /** Stream event flag; used by the host for routing only. */
  stream?: boolean;
  done?: boolean;
}

export class PluginServiceError extends Error {
  constructor(readonly pluginId: string, readonly method: string, message: string) {
    super(`Plugin "${pluginId}" gọi dịch vụ "${method}": ${message}`);
    this.name = 'PluginServiceError';
  }
}

/** Returned by `PluginService.stream()`. `stop()` stops delivery; the
 *  sidecar is not notified, so plugins needing cleanup should call their
 *  own method (e.g. `unsubscribe`) first. */
export interface ServiceSubscription {
  stop(): Promise<void>;
}

/**
 * How the client sends requests to the host. An interface so the client can
 * be tested without a binary. `stream` is optional for test transports.
 */
export interface ServiceTransport {
  send(request: ServiceRequest): Promise<ServiceResponse>;
  stream?(request: ServiceRequest, onMessage: (event: unknown) => void): Promise<ServiceSubscription>;
}

/** Default transport: the host's Tauri commands. */
export const tauriServiceTransport: ServiceTransport = {
  async send(request) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<ServiceResponse>('service_call', { request });
  },

  async stream(request, onMessage) {
    const { invoke, Channel } = await import('@tauri-apps/api/core');
    // The host already unwraps `result`, so events arrive as payloads.
    const channel = new Channel<unknown>();
    channel.onmessage = onMessage;
    await invoke('service_stream_start', { request, channel });
    return {
      async stop() {
        await invoke('service_stream_stop', { bin: request.bin, id: request.id });
      },
    };
  },
};

let idCounter = 0;
function nextId(pluginId: string): string {
  idCounter += 1;
  return `${pluginId}-${idCounter}`;
}

export interface PluginService {
  call<T>(method: string, params?: unknown): Promise<T>;
  /**
   * Calls a method the sidecar treats as a stream (several events per call).
   * `onMessage` receives each event's payload. Call `.stop()` to stop.
   */
  stream<T>(method: string, onMessage: (event: T) => void, params?: unknown): Promise<ServiceSubscription>;
}

/**
 * Client half. Calls are checked in order (service declared, method listed,
 * host error). The manifest and method checks are audited, since a silently
 * blocked call looks like a dead sidecar; host errors are only thrown.
 * `call` and `stream` share the same checks.
 */
export function createPluginService(
  manifest: PluginManifest,
  transport: ServiceTransport = tauriServiceTransport,
): PluginService {
  const id = manifest.id;

  /** Checks permission, records audit, and builds the request. */
  function prepare(method: string, params: unknown): ServiceRequest {
    const service = manifest.service;
    const known = service?.methods.includes(method) ?? false;
    audit.record({
      pluginId: id,
      channel: 'service',
      action: method,
      allowed: known,
      detail: service ? service.bin : 'manifest không khai service',
    });

    if (!service) {
      throw new PluginServiceError(id, method, 'manifest không khai `service`');
    }
    if (!known) {
      throw new PluginServiceError(
        id,
        method,
        `ngoài danh sách methods của "${service.bin}" (${service.methods.join(', ')})`,
      );
    }

    return {
      protocol: SERVICE_PROTOCOL,
      id: nextId(id),
      plugin: id,
      bin: service.bin,
      method,
      params: params ?? null,
    };
  }

  return {
    async call<T>(method: string, params?: unknown): Promise<T> {
      const request = prepare(method, params);
      const response = await transport.send(request);

      if (response.protocol !== SERVICE_PROTOCOL) {
        // Refuse a frame from another protocol version rather than misread it.
        throw new PluginServiceError(
          id,
          method,
          `lệch protocol: host ${response.protocol}, client ${SERVICE_PROTOCOL}`,
        );
      }
      if (response.error !== undefined) {
        throw new PluginServiceError(id, method, response.error);
      }
      return response.result as T;
    },

    async stream<T>(method: string, onMessage: (event: T) => void, params?: unknown): Promise<ServiceSubscription> {
      const request = prepare(method, params);
      if (!transport.stream) {
        throw new PluginServiceError(id, method, 'transport không hỗ trợ stream');
      }
      return transport.stream(request, onMessage as (event: unknown) => void);
    },
  };
}
