import { useMemo } from 'react';
import { usePluginSdkFor } from '@/platform';
import { createRabbitApi, type RabbitApi } from './types';

/**
 * Lớp lệnh gắn với SDK của plugin.
 *
 * Không dùng React context: mọi chỗ gọi đều đã nằm trong một component hoặc một
 * hook, nên một `useMemo` tại chỗ là đủ và rẻ hơn một provider — đồng thời tránh
 * việc các test đang render component con đứng lẻ phải dựng thêm provider chỉ để
 * chạy được.
 */
export function useRabbitApi(): RabbitApi {
  const sdk = usePluginSdkFor('rabbit-client');
  return useMemo(() => createRabbitApi(sdk), [sdk]);
}
