import type { Environment } from './types';

/**
 * Tách GIÁ TRỊ của biến môi trường được đánh dấu `secret` ra khỏi tài liệu
 * environments.
 *
 * Vì sao không bê nguyên mảng `environments` vào kho bí mật: nó không chỉ chứa
 * bí mật. Base URL, tên môi trường, biến thường — toàn thứ người dùng sửa liên
 * tục và các phần khác của store đọc đồng bộ (`migrateLegacyActiveEnv` chẳng
 * hạn). Đưa cả tài liệu sang một kho bất đồng bộ, mã hoá lại từ đầu sau mỗi lần
 * gõ phím, là trả giá lớn cho một phần nhỏ dữ liệu.
 *
 * Nên chỉ GIÁ TRỊ của biến `secret` đi vào kho; cấu trúc ở lại chỗ cũ. Mô hình
 * dữ liệu vốn đã phân biệt sẵn (`KeyValue.secret` có từ trước, dùng để che giá
 * trị trong editor và loại nó khỏi cURL/codegen/history) — ở đây chỉ là dùng
 * đúng cái phân biệt đó cho việc lưu trữ.
 */

/** Khoá trong kho cho một biến. Gồm cả id môi trường vì id biến chỉ duy nhất
 *  trong phạm vi một môi trường. */
export function envSecretKey(envId: string, varId: string): string {
  return `${envId}:${varId}`;
}

export type EnvSecretMap = Record<string, string>;

/**
 * Tài liệu đã rút bí mật + bản đồ bí mật tương ứng.
 *
 * Bản đồ trả về luôn ĐẦY ĐỦ, không phải bản vá: nhờ vậy khi người dùng bỏ đánh
 * dấu `secret` cho một biến (giá trị quay về nằm inline) hoặc xoá hẳn môi
 * trường, mục cũ trong kho biến mất theo thay vì nằm lại vĩnh viễn.
 */
export function splitEnvSecrets(environments: Environment[]): {
  stripped: Environment[];
  secrets: EnvSecretMap;
} {
  const secrets: EnvSecretMap = {};
  const stripped = environments.map((env) => ({
    ...env,
    variables: env.variables.map((v) => {
      if (!v.secret) return v;
      if (v.value !== '') secrets[envSecretKey(env.id, v.id)] = v.value;
      return { ...v, value: '' };
    }),
  }));
  return { stripped, secrets };
}

/** Ghép giá trị bí mật trở lại tài liệu để phần còn lại của app dùng như cũ. */
export function mergeEnvSecrets(stripped: Environment[], secrets: EnvSecretMap): Environment[] {
  return stripped.map((env) => ({
    ...env,
    variables: env.variables.map((v) =>
      v.secret ? { ...v, value: secrets[envSecretKey(env.id, v.id)] ?? v.value } : v,
    ),
  }));
}

/**
 * Còn giá trị bí mật nằm inline trong tài liệu hay không — tín hiệu để di trú
 * một lần cho người dùng nâng cấp từ bản cũ.
 */
export function hasInlineEnvSecrets(environments: Environment[]): boolean {
  return environments.some((env) => env.variables.some((v) => v.secret && v.value !== ''));
}
