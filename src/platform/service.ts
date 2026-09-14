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
}

export class PluginServiceError extends Error {
  constructor(readonly pluginId: string, readonly method: string, message: string) {
    super(`Plugin "${pluginId}" gọi dịch vụ "${method}": ${message}`);
    this.name = 'PluginServiceError';
  }
}

/**
 * Cách client đẩy một request xuống host. Tách ra thành interface để nửa client
 * kiểm thử được trọn vẹn mà không cần binary thật — và để đổi lớp vận chuyển
 * (stdio hôm nay, loopback về sau) không phải sửa gì ở tầng plugin.
 */
export interface ServiceTransport {
  send(request: ServiceRequest): Promise<ServiceResponse>;
}

/** Transport mặc định: đi qua lệnh Tauri của host. */
export const tauriServiceTransport: ServiceTransport = {
  async send(request) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<ServiceResponse>('service_call', { request });
  },
};

let idCounter = 0;
function nextId(pluginId: string): string {
  idCounter += 1;
  return `${pluginId}-${idCounter}`;
}

export interface PluginService {
  call<T>(method: string, params?: unknown): Promise<T>;
}

/**
 * Nửa client. Ba lần chặn trước khi chạm tới tiến trình con, theo thứ tự tăng
 * dần độ cụ thể: có khai `service` không → method có trong danh sách không →
 * host trả lỗi gì. Cả ba đều ghi audit, vì một lời gọi dịch vụ bị chặn im lặng
 * biểu hiện y hệt một sidecar chết.
 */
export function createPluginService(
  manifest: PluginManifest,
  transport: ServiceTransport = tauriServiceTransport,
): PluginService {
  const id = manifest.id;

  return {
    async call<T>(method: string, params?: unknown): Promise<T> {
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

      const response = await transport.send({
        protocol: SERVICE_PROTOCOL,
        id: nextId(id),
        plugin: id,
        bin: service.bin,
        method,
        params: params ?? null,
      });

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
  };
}
