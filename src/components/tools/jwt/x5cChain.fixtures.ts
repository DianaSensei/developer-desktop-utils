// Test fixtures only — never imported by app code.
//
// A throwaway P-256 chain shaped like Apple's (root → "WWDR" intermediate →
// "App Store signing" leaf, with Apple's marker OIDs on the intermediate and
// leaf). It is generated when the tests run, so no private key is ever
// committed — and it is NOT Apple's: tests use it with a custom trusted
// root, and to show the Apple root rejects it.

import 'reflect-metadata';
import {
  BasicConstraintsExtension, Extension, KeyUsageFlags, KeyUsagesExtension,
  X509CertificateGenerator, type X509Certificate,
} from '@peculiar/x509';

const APPLE_LEAF_OID = '1.2.840.113635.100.6.11.1';
const APPLE_INTERMEDIATE_OID = '1.2.840.113635.100.6.2.1';
/** DER of ASN.1 NULL, the value Apple's marker extensions carry. */
const ASN1_NULL = new Uint8Array([0x05, 0x00]);

const ALG = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;
const DAY = 86_400_000;

export interface TestChain {
  root: string;
  intermediate: string;
  leaf: string;
  /** Same issuer as `leaf`, without Apple's leaf OID. */
  leafNoOid: string;
  /** Issued by `leaf`, which is not a CA. */
  signedByLeaf: string;
  /** Private key of `leaf` (and `leafNoOid`), to sign test JWS with. */
  leafKey: CryptoKey;
}

const b64 = (cert: X509Certificate) => cert.toString('base64');

let cached: Promise<TestChain> | undefined;

/** The chain, generated once per test file. */
export function testChain(): Promise<TestChain> {
  cached ??= build();
  return cached;
}

async function build(): Promise<TestChain> {
  const keys = () => crypto.subtle.generateKey(ALG, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;
  const [rootKeys, interKeys, leafKeys, childKeys] = await Promise.all([keys(), keys(), keys(), keys()]);
  const notBefore = new Date(Date.now() - DAY);
  const notAfter = new Date(Date.now() + 3650 * DAY);
  let serial = 1;

  const issue = (opts: {
    subject: string; issuer: X509Certificate | null; keys: CryptoKeyPair; signer: CryptoKeyPair;
    ca: boolean; oid?: string;
  }) => X509CertificateGenerator.create({
    serialNumber: String(serial++).padStart(2, '0'),
    subject: opts.subject,
    issuer: opts.issuer?.subject ?? opts.subject,
    notBefore,
    notAfter,
    signingAlgorithm: ALG,
    publicKey: opts.keys.publicKey,
    signingKey: opts.signer.privateKey,
    extensions: [
      new BasicConstraintsExtension(opts.ca, opts.ca ? 0 : undefined, true),
      new KeyUsagesExtension(opts.ca ? KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign : KeyUsageFlags.digitalSignature, true),
      ...(opts.oid ? [new Extension(opts.oid, false, ASN1_NULL)] : []),
    ],
  });

  const root = await X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=Test Root CA',
    notBefore,
    notAfter,
    signingAlgorithm: ALG,
    keys: rootKeys,
    extensions: [
      new BasicConstraintsExtension(true, undefined, true),
      new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
    ],
  });
  serial = 2;
  const inter = await issue({ subject: 'CN=Test WWDR', issuer: root, keys: interKeys, signer: rootKeys, ca: true, oid: APPLE_INTERMEDIATE_OID });
  const leaf = await issue({ subject: 'CN=Test App Store Signing', issuer: inter, keys: leafKeys, signer: interKeys, ca: false, oid: APPLE_LEAF_OID });
  const leafNoOid = await issue({ subject: 'CN=Test App Store Signing', issuer: inter, keys: leafKeys, signer: interKeys, ca: false });
  const signedByLeaf = await issue({ subject: 'CN=Signed By Leaf', issuer: leaf, keys: childKeys, signer: leafKeys, ca: false });

  return {
    root: b64(root),
    intermediate: b64(inter),
    leaf: b64(leaf),
    leafNoOid: b64(leafNoOid),
    signedByLeaf: b64(signedByLeaf),
    leafKey: leafKeys.privateKey,
  };
}

/** Apple Worldwide Developer Relations CA - G6, the real intermediate under Apple Root CA - G3 (public certificate). */
export const APPLE_WWDR_G6 = 'MIIDFjCCApygAwIBAgIUIsGhRwp0c2nvU4YSycafPTjzbNcwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMjEwMzE3MjAzNzEwWhcNMzYwMzE5MDAwMDAwWjB1MUQwQgYDVQQDDDtBcHBsZSBXb3JsZHdpZGUgRGV2ZWxvcGVyIFJlbGF0aW9ucyBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTELMAkGA1UECwwCRzYxEzARBgNVBAoMCkFwcGxlIEluYy4xCzAJBgNVBAYTAlVTMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEbsQKC94PrlWmZXnXgtxzdVJL8T0SGYngDRGpngn3N6PT8JMEb7FDi4bBmPhCnZ3/sq6PF/cGcKXWsL5vOteRhyJ45x3ASP7cOB+aao90fcpxSv/EZFbniAbNgZGhIhpIo4H6MIH3MBIGA1UdEwEB/wQIMAYBAf8CAQAwHwYDVR0jBBgwFoAUu7DeoVgziJqkipnevr3rr9rLJKswRgYIKwYBBQUHAQEEOjA4MDYGCCsGAQUFBzABhipodHRwOi8vb2NzcC5hcHBsZS5jb20vb2NzcDAzLWFwcGxlcm9vdGNhZzMwNwYDVR0fBDAwLjAsoCqgKIYmaHR0cDovL2NybC5hcHBsZS5jb20vYXBwbGVyb290Y2FnMy5jcmwwHQYDVR0OBBYEFD8vlCNR01DJmig97bB85c+lkGKZMA4GA1UdDwEB/wQEAwIBBjAQBgoqhkiG92NkBgIBBAIFADAKBggqhkjOPQQDAwNoADBlAjBAXhSq5IyKogMCPtw490BaB677CaEGJXufQB/EqZGd6CSjiCtOnuMTbXVXmxxcxfkCMQDTSPxarZXvNrkxU3TkUMI33yzvFVVRT4wxWJC994OsdcZ4+RGNsYDyR5gmdr0nDGg=';
