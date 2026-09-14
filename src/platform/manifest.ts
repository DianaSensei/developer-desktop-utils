import { SDK_VERSION, type PluginManifest, type PluginPermission } from './types';

/**
 * Khai báo một plugin. Thuần tuý là hàm định danh — nó tồn tại để TypeScript
 * suy ra đúng kiểu tại chỗ khai báo (báo lỗi ngay trong file plugin thay vì ở
 * chỗ registry gom lại), và để `import.meta.glob` có một hình dạng export cố
 * định mà bám vào.
 */
export function definePlugin(manifest: PluginManifest): PluginManifest {
  return manifest;
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HOST_PATTERN = /^(?:\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

/** `*`, `example.com`, `*.example.com`. Cố tình KHÔNG nhận `*abc.com` hay
 *  `a.*.com`: wildcard nửa vời rất dễ khớp rộng hơn người viết tưởng. */
function isHostPattern(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value === '*' || HOST_PATTERN.test(value);
}

/** Host của `url` có nằm trong allowlist không. Dùng bởi SDK lúc chạy. */
export function hostAllowed(hosts: readonly string[], url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hosts.some((pattern) => {
    if (pattern === '*') return true;
    const p = pattern.toLowerCase();
    if (p.startsWith('*.')) {
      const suffix = p.slice(2);
      return hostname === suffix || hostname.endsWith(`.${suffix}`);
    }
    return hostname === p;
  });
}
const VALID_PERMISSIONS: PluginPermission[] = [
  'storage',
  'secrets',
  'clipboard:read',
  'clipboard:write',
  'http',
  'native',
  'service',
];

/**
 * Kiểm `range` dạng `^M.m.p` với version SDK hiện tại.
 *
 * Chỉ hỗ trợ caret, cố ý: đó là dải duy nhất manifest được phép khai, nên kéo
 * cả một thư viện semver vào bundle của app chỉ để so ba con số là không đáng.
 * Quy ước caret chuẩn — major phải bằng nhau, minor.patch của SDK phải ≥ của
 * range — cộng thêm luật 0.x: khi major = 0 thì minor cũng phải bằng nhau.
 */
export function satisfiesSdk(range: string, version: string = SDK_VERSION): boolean {
  const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  if (!m) return false;
  const v = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!v) return false;
  const [wantMajor, wantMinor, wantPatch] = m.slice(1).map(Number);
  const [haveMajor, haveMinor, havePatch] = v.slice(1).map(Number);

  if (haveMajor !== wantMajor) return false;
  if (wantMajor === 0 && haveMinor !== wantMinor) return false;
  if (haveMinor !== wantMinor) return haveMinor > wantMinor;
  return havePatch >= wantPatch;
}

/**
 * Kiểm một manifest. Trả về danh sách lý do hỏng (rỗng = hợp lệ) thay vì ném:
 * registry cần loại đúng plugin hỏng và vẫn dựng được app với phần còn lại —
 * một manifest sai chính tả không đáng làm trắng cả cửa sổ.
 */
export function validateManifest(input: unknown): string[] {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null) return ['manifest không phải object'];
  const m = input as Partial<PluginManifest>;

  if (typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) {
    errors.push(`id "${String(m.id)}" phải là kebab-case (a-z, 0-9, dấu gạch nối)`);
  }
  if (typeof m.label !== 'string' || m.label.trim() === '') errors.push('thiếu label');
  if (typeof m.description !== 'string' || m.description.trim() === '') errors.push('thiếu description');
  if (typeof m.icon !== 'function' && typeof m.icon !== 'object') errors.push('icon phải là một LucideIcon');
  if (typeof m.route !== 'string' || !m.route.startsWith('/')) {
    errors.push(`route "${String(m.route)}" phải là đường dẫn tuyệt đối, bắt đầu bằng "/"`);
  }
  if (!Number.isInteger(m.order)) errors.push('order phải là số nguyên');
  if (typeof m.defaultEnabled !== 'boolean') errors.push('defaultEnabled phải là boolean');
  if (typeof m.load !== 'function') errors.push('load phải là hàm trả về Promise<ComponentType>');

  if (typeof m.sdk !== 'string') {
    errors.push('thiếu sdk range');
  } else if (!satisfiesSdk(m.sdk)) {
    errors.push(`sdk "${m.sdk}" không tương thích Platform SDK ${SDK_VERSION}`);
  }

  for (const p of m.permissions ?? []) {
    if (!VALID_PERMISSIONS.includes(p)) errors.push(`quyền không hợp lệ: "${p}"`);
  }
  if ((m.commands?.length ?? 0) > 0 && !(m.permissions ?? []).includes('native')) {
    errors.push('khai commands nhưng thiếu quyền "native"');
  }
  if ((m.permissions ?? []).includes('native') && (m.commands?.length ?? 0) === 0) {
    errors.push('có quyền "native" nhưng không khai commands — quyền native luôn phải kèm allowlist');
  }

  // Cùng luật với 'native': quyền mạng không kèm allowlist host là quyền gọi
  // đi bất cứ đâu, và đó chính là thứ cần nhìn thấy được.
  const hasHttp = (m.permissions ?? []).includes('http');
  if (hasHttp !== ((m.hosts?.length ?? 0) > 0)) {
    errors.push(
      hasHttp
        ? 'có quyền "http" nhưng không khai hosts — dùng ["*"] nếu plugin thật sự gọi được mọi nơi'
        : 'khai hosts nhưng thiếu quyền "http"',
    );
  }
  for (const h of m.hosts ?? []) {
    if (!isHostPattern(h)) errors.push(`host "${h}" không hợp lệ — dùng "example.com", "*.example.com" hoặc "*"`);
  }

  // Cùng một luật "quyền phải đi kèm allowlist" như 'native', vì lý do giống
  // hệt: một sidecar không giới hạn method là một quyền mở vô hạn.
  const hasService = (m.permissions ?? []).includes('service');
  if (hasService !== (m.service !== undefined)) {
    errors.push(
      hasService
        ? 'có quyền "service" nhưng không khai service descriptor'
        : 'khai service descriptor nhưng thiếu quyền "service"',
    );
  }
  if (m.service) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(m.service.bin)) {
      errors.push(`service.bin "${m.service.bin}" phải là tên binary kebab-case, không kèm đuôi hay target-triple`);
    }
    if (m.service.methods.length === 0) {
      errors.push('service.methods rỗng — sidecar không giới hạn method là quyền mở vô hạn');
    }
  }

  return errors;
}
