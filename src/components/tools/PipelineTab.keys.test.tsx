import { afterEach, describe, expect, it } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { PipelineTab } from '@/components/tools/PipelineTab';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { createHmac } from 'node:crypto';
import { storageGet, storageRemove, storageSet } from '@/lib/persistentStore';
import { secretGet } from '@/platform/secrets';

/** HMAC keys of pipeline steps are credentials: they must live in the vault,
 *  not in the plain settings that hold the steps. */

const STEPS_KEY = 'devtool:base64:pipeline:steps-v2';

afterEach(() => {
  cleanup();
  storageRemove(STEPS_KEY);
  sessionStorage.clear();
});

describe('Pipeline — HMAC step keys', () => {
  it('moves a key saved by an earlier version into the vault and drops it from the steps', async () => {
    storageSet(
      STEPS_KEY,
      JSON.stringify([
        { id: 's1', op: 'text-sunk', textValue: 'amount=100' },
        { id: 's2', op: 'hmac', algorithm: 'sha256', key: 'sk_live_SECRET123', upperHex: false },
      ]),
    );
    const view = render(<AppConfigProvider><LocaleProvider><PipelineTab active /></LocaleProvider></AppConfigProvider>);

    await waitFor(() => expect(storageGet(STEPS_KEY)).not.toContain('sk_live_SECRET123'));
    expect(JSON.parse((await secretGet('base64', 'pipeline:step-keys'))!)).toEqual({ s2: 'sk_live_SECRET123' });
    // The step still signs with it.
    const expected = createHmac('sha256', 'sk_live_SECRET123').update('amount=100').digest('hex');
    await waitFor(() => expect(view.container.textContent).toContain(expected));
  });
});
