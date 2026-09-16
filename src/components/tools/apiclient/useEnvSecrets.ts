import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { useSecretState, type PluginSdk } from '@/platform';
import { hasInlineEnvSecrets, mergeEnvSecrets, splitEnvSecrets, type EnvSecretMap } from './envSecrets';
import type { Environment } from './types';

/**
 * `environments` với giá trị của biến `secret` nằm trong kho bí mật đã mã hoá,
 * phần còn lại vẫn ở store thường.
 *
 * Bên ngoài hook này không ai phải biết chuyện đó: `environments` trả ra đã
 * ghép đủ, và `setEnvironments` nhận updater y như `usePersistentState` trước
 * đây — nên bảy chỗ gọi trong store.ts không đổi một dòng nào.
 *
 * Phần lưu trữ thường được TRUYỀN VÀO chứ không do hook tự tạo: store.ts vốn đã
 * quản lý mọi khoá khác của tool ở cùng một chỗ, nên để nó giữ nốt khoá này thì
 * bố cục nhất quán hơn, hook thành một phép ghép thuần và dễ kiểm thử hơn.
 */
export function useEnvSecrets(
  sdk: PluginSdk,
  stripped: Environment[],
  setStripped: Dispatch<SetStateAction<Environment[]>>,
): [Environment[], Dispatch<SetStateAction<Environment[]>>, boolean] {
  const [secrets, setSecrets, ready] = useSecretState<EnvSecretMap>(sdk, 'envSecrets', {});

  const environments = useMemo(() => mergeEnvSecrets(stripped, secrets), [stripped, secrets]);

  const environmentsRef = useRef(environments);
  environmentsRef.current = environments;

  const setEnvironments = useCallback<Dispatch<SetStateAction<Environment[]>>>(
    (action) => {
      const next =
        typeof action === 'function'
          ? (action as (prev: Environment[]) => Environment[])(environmentsRef.current)
          : action;
      const split = splitEnvSecrets(next);
      setStripped(split.stripped);
      setSecrets(split.secrets);
    },
    [setStripped, setSecrets],
  );

  useEffect(() => {
    // Di trú một lần cho người nâng cấp: bản cũ ghi giá trị bí mật thẳng vào
    // `devtool:apiclient:environments`. Chỉ chạy SAU khi kho đọc xong — chạy
    // sớm hơn sẽ ghi một bản đồ rỗng đè lên bí mật thật đang có.
    if (!ready) return;
    if (!hasInlineEnvSecrets(stripped)) return;

    const split = splitEnvSecrets(stripped);
    setStripped(split.stripped);
    // Gộp chứ không thay: giá trị đã nằm sẵn trong kho là bản mới hơn, giá trị
    // inline chỉ là tàn dư của bản cũ, nên nó không được phép đè lên.
    setSecrets((prev) => ({ ...split.secrets, ...prev }));
  }, [ready, stripped, setStripped, setSecrets]);

  return [environments, setEnvironments, ready];
}
