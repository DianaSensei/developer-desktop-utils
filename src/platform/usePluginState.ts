import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';
import type { PluginSdk } from './sdk';

interface Options {
  /** Gộp các lần ghi liên tiếp lại, ms. Giống hệt `usePersistentState`. */
  debounceMs?: number;
  /**
   * Khoá cũ, đầy đủ, mà tool này đang dùng trước khi chuyển sang SDK.
   *
   * Bắt buộc phải có ở gần như mọi lần chuyển đổi, vì tiền tố khoá lịch sử hiếm
   * khi trùng id plugin: Redis Client lưu ở `devtool:redis:*` nhưng id của nó là
   * `redis-client`, API Client lưu ở `devtool:apiclient:*` nhưng id là
   * `api-client`. Chuyển thẳng mà không khai khoá cũ là im lặng vứt đi lựa chọn
   * kết nối, lịch sử và cấu hình người dùng đang có — trông y như app tự reset.
   *
   * Di trú chạy MỘT LẦN lúc dựng và chỉ khi khoá mới còn trống: giá trị ở khoá
   * mới luôn là bản mới hơn.
   */
  legacyKey?: string;
}

/**
 * `usePersistentState` của Platform: y hệt về hành vi (đọc đồng bộ lúc dựng,
 * ghi có debounce, xả khi cửa sổ ẩn/đóng), chỉ khác ở hai điểm — khoá được gắn
 * namespace theo plugin, và quyền `storage` được kiểm.
 *
 * Đây là mảnh còn thiếu để một tool chuyển hẳn sang SDK. 47 chỗ trong bốn tool
 * nặng đang gọi thẳng `usePersistentState`; không có hook này thì chúng KHÔNG có
 * đường nào để chuyển, vì `sdk.storage` là API mệnh lệnh còn cái chúng cần là
 * một `useState` có ghi nhớ.
 *
 * Audit ghi ĐÚNG MỘT dòng cho mỗi khoá lúc gắn, không ghi theo từng lần gõ
 * phím: một editor văn bản sẽ đẩy hàng nghìn dòng vào bộ đệm vòng 500 mục và
 * cuốn trôi mọi thứ khác — nhật ký khi đó vừa vô dụng vừa che mất đúng những
 * lời gọi đáng chú ý.
 */
/**
 * Chuyển một khoá từ vị trí cũ sang khoá có namespace, đúng một lần.
 *
 * Tách ra khỏi hook vì các store ở phạm vi module cũng cần nó — chúng dùng
 * `sdk.storage` trực tiếp, không qua `usePluginState`, nhưng vẫn phải mang dữ
 * liệu cũ của người dùng theo.
 *
 * Chỉ chép khi khoá mới còn trống: giá trị ở khoá mới luôn là bản mới hơn.
 */
export function migrateLegacyKey(sdk: PluginSdk, key: string, legacyKey: string): void {
  const full = sdk.storage.key(key);
  if (legacyKey === full) return;
  if (sdk.storage.get(key) !== null) return;

  const old = storageGet(legacyKey);
  if (old === null) return;
  // Ghi thẳng qua store: giá trị ĐÃ ở đúng dạng chuỗi đã lưu, không cần đi qua
  // một vòng parse/stringify chỉ để chuyển chỗ.
  storageSet(full, old);
  storageRemove(legacyKey);
}

export function usePluginState<T>(
  sdk: PluginSdk,
  key: string,
  initial: T | (() => T),
  options?: Options,
): [T, Dispatch<SetStateAction<T>>] {
  const namespaced = useMemo(() => {
    // Lời gọi này vừa kiểm quyền (ném nếu manifest chưa khai `storage`) vừa để
    // lại một dòng audit cho khoá — giá trị đọc ra được dùng tiếp ngay bên dưới.
    sdk.storage.get(key);
    if (options?.legacyKey) migrateLegacyKey(sdk, key, options.legacyKey);
    return sdk.storage.key(key);
    // `options.legacyKey` cố tình không nằm trong deps: di trú là việc một lần
    // lúc dựng, và khoá cũ không đổi giữa các lần render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk, key]);

  return usePersistentState<T>(namespaced, initial, options);
}
