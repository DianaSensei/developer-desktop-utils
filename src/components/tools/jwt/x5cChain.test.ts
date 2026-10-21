// @vitest-environment node
//
// Node rather than jsdom: Web Crypto keys and jose's `instanceof Uint8Array`
// checks need a single realm (see jwtCrypto.test.ts).

import { describe, expect, it } from 'vitest';
import { APPLE_ROOT_CA_G3, verifyX5cChain } from '@/components/tools/jwt/x5cChain';
import {
  APPLE_WWDR_G6, TEST_INTERMEDIATE, TEST_LEAF, TEST_LEAF_NO_OID, TEST_ROOT, TEST_SIGNED_BY_LEAF,
} from '@/components/tools/jwt/x5cChain.fixtures';

const chain = [TEST_LEAF, TEST_INTERMEDIATE, TEST_ROOT];

describe('x5c chain', () => {
  it('accepts a chain that ends at the pinned root', async () => {
    await expect(verifyX5cChain(chain, { roots: [TEST_ROOT], apple: true })).resolves.toBeUndefined();
  });

  it('accepts a chain without the root, when the pinned root signed its top', async () => {
    await expect(verifyX5cChain([TEST_LEAF, TEST_INTERMEDIATE], { roots: [TEST_ROOT] })).resolves.toBeUndefined();
  });

  it('verifies the real Apple WWDR G6 intermediate against the pinned Apple Root CA - G3', async () => {
    await expect(verifyX5cChain([APPLE_WWDR_G6, APPLE_ROOT_CA_G3], { roots: [APPLE_ROOT_CA_G3], at: new Date('2026-01-01') }))
      .resolves.toBeUndefined();
  });

  it('rejects a look-alike chain when the trusted root is Apple', async () => {
    await expect(verifyX5cChain(chain, { roots: [APPLE_ROOT_CA_G3], apple: true }))
      .rejects.toThrow(/not the trusted root \(Apple Root CA - G3\)/);
  });

  it('rejects a chain whose links do not sign each other', async () => {
    await expect(verifyX5cChain([TEST_LEAF, APPLE_WWDR_G6, APPLE_ROOT_CA_G3], { roots: [APPLE_ROOT_CA_G3] }))
      .rejects.toThrow(/x5c\[0\] was issued by/);
  });

  it('rejects an Apple-mode chain missing the leaf marker OID', async () => {
    await expect(verifyX5cChain([TEST_LEAF_NO_OID, TEST_INTERMEDIATE, TEST_ROOT], { roots: [TEST_ROOT], apple: true }))
      .rejects.toThrow(/1\.2\.840\.113635\.100\.6\.11\.1/);
  });

  it('rejects a certificate outside its validity period', async () => {
    await expect(verifyX5cChain(chain, { roots: [TEST_ROOT], at: new Date('2020-01-01') }))
      .rejects.toThrow(/not valid at 2020-01-01/);
  });

  it('rejects a leaf used as an issuer', async () => {
    await expect(verifyX5cChain([TEST_SIGNED_BY_LEAF, ...chain], { roots: [TEST_ROOT] }))
      .rejects.toThrow(/x5c\[1\].*not a CA certificate/);
  });

  it('says what is missing', async () => {
    await expect(verifyX5cChain(undefined, { roots: [TEST_ROOT] })).rejects.toThrow(/no x5c/);
    await expect(verifyX5cChain(['not-a-cert'], { roots: [TEST_ROOT] })).rejects.toThrow(/x5c\[0\] is not a valid X\.509/);
    await expect(verifyX5cChain(chain.slice(0, 2), { roots: [TEST_ROOT], apple: true })).rejects.toThrow(/chain of 3/);
  });
});
