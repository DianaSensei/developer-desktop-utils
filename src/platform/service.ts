import * as audit from './audit';
import type { PluginManifest } from './types';

/**
 * Tier B — plugin dịch vụ (sidecar).
 *
 * Một plugin cần thứ webview không làm được (socket thô, filesystem, SDK của hệ
 * sinh thái khác) khai thêm `service` trong manifest. Platform chạy binary đó
 * như một TIẾN TRÌNH RIÊNG và plugin nói chuyện với nó qua `sdk.service.call()`.
 *
 * Vì sao tiến trình riêng chứ không phải thêm lệnh vào `main.rs`:
 * `tauri::generate_handler!` là macro lúc biên dịch — không thêm lệnh lúc chạy
 * được. Ngoài ra `panic = "abort"` trong profile release nghĩa là một panic
 * trong code dịch vụ sẽ giết cả app, kéo theo mọi consumer Kafka và tab API
 * Client đang mở của người dùng. Tiến trình riêng thì chỉ dịch vụ đó chết.
 *
 * File này là NỬA CLIENT của hợp đồng: đóng gói lời gọi, kiểm quyền, ghi audit,
 * và định nghĩa khung tin nhắn. Nửa host (spawn, giám sát, timeout, dọn tiến
 * trình mồ côi) nằm ở Rust và có vòng đời phát hành riêng — nên khung tin nhắn
 * ở đây mang `protocol`, để host cũ gặp client mới biết đường từ chối tử tế
 * thay vì diễn giải sai payload.
 */

/** Phiên bản khung tin nhắn giữa client và host. Tăng khi đổi hình dạng khung. */
export const SERVICE_PROTOCOL = 1;

export interface ServiceDescriptor {
  /**
   * Tên binary sidecar, KHÔNG kèm đuôi và target-triple (Tauri tự ghép lúc
   * chạy). Phải khớp một mục trong `bundle.externalBin` của tauri.conf.json.
   */
  bin: string;
  /** Method sidecar này phục vụ. Lời gọi ngoài danh sách bị chặn ở client. */
  methods: string[];
  /** Hạn cho một lời gọi, ms. Mặc định 30s, khớp CALL_TIMEOUT của mcp_bridge. */
  timeoutMs?: number;
}

export interface ServiceRequest {
  protocol: number;
  /** Định danh lời gọi, để ghép với phản hồi trên một kênh dùng chung. */
  id: string;
  plugin: string;
  /**
   * Binary cần chạy. Client nêu tên, nhưng RANH GIỚI TIN CẬY nằm ở host: chỉ
   * tên có trong allowlist của Rust (`service_host.rs`) mới được chạy. Manifest
   * do webview đọc, nên nó không thể là nơi quyết định tiến trình nào được sinh.
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
  /** Dòng này là MỘT TRONG NHIỀU sự kiện của một stream — chỉ có ý nghĩa phía
   *  host Rust (định tuyến theo `id`); client không cần đọc trường này, sự
   *  kiện đã được host tách sẵn ra `onMessage` trước khi tới đây. */
  stream?: boolean;
  done?: boolean;
}

export class PluginServiceError extends Error {
  constructor(readonly pluginId: string, readonly method: string, message: string) {
    super(`Plugin "${pluginId}" gọi dịch vụ "${method}": ${message}`);
    this.name = 'PluginServiceError';
  }
}

/** Trả về từ `PluginService.stream()` — huỷ đăng ký, KHÔNG đảm bảo sidecar
 *  biết việc này (xem `service_stream_stop` phía Rust): dọn tài nguyên phía
 *  sidecar, nếu cần, là việc của một method riêng plugin tự định nghĩa (ví dụ
 *  `unsubscribe`), gọi qua `call()` TRƯỚC khi gọi `stop()` ở đây. */
export interface ServiceSubscription {
  stop(): Promise<void>;
}

/**
 * Cách client đẩy một request xuống host. Tách ra thành interface để nửa client
 * kiểm thử được trọn vẹn mà không cần binary thật — và để đổi lớp vận chuyển
 * (stdio hôm nay, loopback về sau) không phải sửa gì ở tầng plugin.
 *
 * `stream` là TUỲ CHỌN: transport giả trong test chỉ cần cài nó khi ca đó thật
 * sự kiểm phần stream — mọi test đã có cho `call()` không phải biết gì về nó.
 */
export interface ServiceTransport {
  send(request: ServiceRequest): Promise<ServiceResponse>;
  stream?(request: ServiceRequest, onMessage: (event: unknown) => void): Promise<ServiceSubscription>;
}

/** Transport mặc định: đi qua lệnh Tauri của host. */
export const tauriServiceTransport: ServiceTransport = {
  async send(request) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<ServiceResponse>('service_call', { request });
  },

  async stream(request, onMessage) {
    const { invoke, Channel } = await import('@tauri-apps/api/core');
    // `Channel<unknown>` nhận thẳng PAYLOAD của sự kiện — service_host.rs đã
    // tách `result` ra khỏi khung `ServiceResponse` trước khi gửi qua đây, nên
    // không cần bóc thêm một lớp nào ở phía JS.
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
   * Gọi một method mà sidecar coi là STREAM (nhiều sự kiện cho cùng một lời
   * gọi — Pub/Sub, tail log…) thay vì một-lần. `onMessage` nhận đúng payload
   * của mỗi sự kiện, không phải khung `ServiceResponse` thô. Trả về một
   * `ServiceSubscription` — gọi `.stop()` khi không cần nghe nữa.
   */
  stream<T>(method: string, onMessage: (event: T) => void, params?: unknown): Promise<ServiceSubscription>;
}

/**
 * Nửa client. Ba lần chặn trước khi chạm tới tiến trình con, theo thứ tự tăng
 * dần độ cụ thể: có khai `service` không → method có trong danh sách không →
 * host trả lỗi gì. Cả ba đều ghi audit, vì một lời gọi dịch vụ bị chặn im lặng
 * biểu hiện y hệt một sidecar chết. `call` và `stream` dùng CHUNG lớp chặn này
 * — một method stream không nằm trong `service.methods` bị từ chối y hệt một
 * method một-lần không có trong đó.
 */
export function createPluginService(
  manifest: PluginManifest,
  transport: ServiceTransport = tauriServiceTransport,
): PluginService {
  const id = manifest.id;

  /** Kiểm quyền, ghi audit, và dựng sẵn `ServiceRequest` — dùng chung cho cả
   *  `call` lẫn `stream`. Ném `PluginServiceError` nếu bị chặn. */
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
        // Sidecar cũ hơn app (hoặc ngược lại): từ chối thẳng. Diễn giải một
        // payload của phiên bản khác là cách nhanh nhất để sinh ra lỗi dữ liệu
        // im lặng thay vì một thông báo đọc được.
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
