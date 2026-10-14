import { describe, expect, it } from 'vitest';
import { compareCodeUnits } from '@/components/tools/PipelineTab';

describe('Pipeline JSON input — key sort', () => {
  it('sorts in ASCII order, as payment gateways sign', () => {
    const keys = ['vpc_Merchant', 'vpc_MerchTxnRef', 'Version', 'amount', 'vpc_Amount'];
    expect([...keys].sort(compareCodeUnits)).toEqual(['Version', 'amount', 'vpc_Amount', 'vpc_MerchTxnRef', 'vpc_Merchant']);
  });
});
