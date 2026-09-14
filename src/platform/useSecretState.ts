import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PluginSdk } from './sdk';

/**
 * `usePersistentState` cho dữ liệu nhạy cảm: giá trị nằm trong kho bí mật riêng
 * (xem `secrets.ts`) thay vì mặt phẳng khoá dùng chung.
 *
 * Khác biệt quan trọng so với bản đồng bộ: kho là bất đồng bộ, nên lần render
 * đầu KHÔNG có dữ liệu. Hook trả về cờ `ready`, và **không ghi gì cho tới khi
 * đọc xong** — thiếu chốt đó, effect ghi của lần render đầu sẽ đẩy giá trị khởi
 * tạo (thường là mảng rỗng) đè lên dữ liệu thật vừa kịp đọc lên: người dùng mở
 * app ra là mất sạch tài khoản.
 */
export function useSecretState<T>(
  sdk: PluginSdk,
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [state, setState] = useState<T>(initial);
  const [ready, setReady] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await sdk.secrets.get(key);
        if (cancelled) return;
        if (raw !== null) {
          try {
            setState(JSON.parse(raw) as T);
          } catch {
            // Blob hỏng: giữ lại nguyên văn dưới một khoá khác TRƯỚC khi cho
            // phép ghi đè. Người dùng còn cơ hội khôi phục thủ công, thay vì
            // mất dữ liệu vì một lần ghi hỏng ở phiên trước.
            await sdk.secrets.set(`${key}.corrupt`, raw);
            sdk.log('secret-corrupt', key);
          }
        }
      } catch {
        // Thiếu quyền hoặc kho không mở được — để nguyên giá trị khởi tạo.
        // `ensure()` của SDK đã ghi audit nên lỗi không biến mất im lặng.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sdk, key]);

  useEffect(() => {
    if (!ready) return;
    void sdk.secrets.set(key, JSON.stringify(stateRef.current)).catch(() => {
      // Đã ghi audit ở tầng SDK.
    });
  }, [state, ready, sdk, key]);

  const set = useCallback<Dispatch<SetStateAction<T>>>((value) => setState(value), []);

  return [state, set, ready];
}
