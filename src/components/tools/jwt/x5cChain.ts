// Certificate-chain check for a JWS `x5c` header (RFC 7515 §4.1.6).
//
// Verifying a signature against the leaf certificate a token carries only
// proves the token was signed by *some* key — anyone can mint a certificate
// and put it in `x5c`. What makes Apple's signed payloads (App Store Server
// API / Notifications, Advanced Commerce) trustworthy is that the chain ends
// at Apple Root CA - G3. This module checks exactly that, the way Apple's own
// app-store-server-library does:
//
//   - every certificate is signed by the next one, names chain, and is valid
//     at the effective date;
//   - every certificate above the leaf is a CA;
//   - the chain ends at a pinned root (byte-for-byte), or at a certificate the
//     pinned root signed;
//   - for Apple: the leaf carries the App Store receipt-signing OID and the
//     intermediate the WWDR OID, so no other Apple-issued certificate passes.
//
// Not done: revocation (OCSP/CRL) — that needs the network, and this app
// makes no network call the user didn't start. The UI says so.
//
// Loaded lazily (`import()` from pipelineEngine.ts): @peculiar/x509 is large
// and only needed when someone verifies with x5c.

// @peculiar/x509 resolves its algorithm providers through tsyringe, which
// needs the Reflect metadata polyfill loaded first. This module is only ever
// reached through a dynamic import, so the polyfill loads with it.
import 'reflect-metadata';
import { BasicConstraintsExtension, X509Certificate } from '@peculiar/x509';

/**
 * Apple Root CA - G3, DER as base64, from
 * https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
 * SHA-256 fingerprint 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79
 * (valid 2014-04-30 – 2039-04-30).
 */
export const APPLE_ROOT_CA_G3 =
  'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==';

/** Apple's marker OIDs, as checked by app-store-server-library. */
const APPLE_LEAF_OID = '1.2.840.113635.100.6.11.1';
const APPLE_INTERMEDIATE_OID = '1.2.840.113635.100.6.2.1';

export interface ChainOptions {
  /** Trusted roots: PEM or base64 DER. */
  roots: string[];
  /** Also require Apple's leaf / intermediate OIDs. */
  apple?: boolean;
  /** Validity is checked at this time. */
  at?: Date;
}

function parse(cert: string, what: string): X509Certificate {
  try {
    return new X509Certificate(cert.trim());
  } catch {
    throw new Error(`${what} is not a valid X.509 certificate.`);
  }
}

function sameDer(a: X509Certificate, b: X509Certificate): boolean {
  const x = new Uint8Array(a.rawData), y = new Uint8Array(b.rawData);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

const describe = (c: X509Certificate) => c.subject || 'certificate';

/** Throws an Error saying which link of the chain is wrong; resolves when the chain is trusted. */
export async function verifyX5cChain(x5c: unknown, opts: ChainOptions): Promise<void> {
  if (!Array.isArray(x5c) || x5c.length === 0 || !x5c.every((c) => typeof c === 'string')) {
    throw new Error('The token header has no x5c certificate chain.');
  }
  if (opts.roots.length === 0) throw new Error('No trusted root certificate to check the chain against.');
  const chain = (x5c as string[]).map((c, i) => parse(c, `x5c[${i}]`));
  const roots = opts.roots.map((r, i) => parse(r, opts.roots.length > 1 ? `Trusted root #${i + 1}` : 'Trusted root'));
  const at = opts.at ?? new Date();

  if (opts.apple && chain.length !== 3) {
    throw new Error(`Apple signs with a chain of 3 certificates (leaf, WWDR intermediate, root); this x5c has ${chain.length}.`);
  }

  for (let i = 0; i < chain.length; i++) {
    const cert = chain[i];
    if (at < cert.notBefore || at > cert.notAfter) {
      throw new Error(`x5c[${i}] (${describe(cert)}) is not valid at ${at.toISOString()} — valid ${cert.notBefore.toISOString()} to ${cert.notAfter.toISOString()}.`);
    }
    if (i > 0) {
      const bc = cert.getExtension(BasicConstraintsExtension);
      if (!bc?.ca) throw new Error(`x5c[${i}] (${describe(cert)}) is not a CA certificate, so it cannot issue x5c[${i - 1}].`);
    }
    const issuer = chain[i + 1];
    if (!issuer) break;
    if (cert.issuer !== issuer.subject) {
      throw new Error(`x5c[${i}] was issued by "${cert.issuer}", but the next certificate is "${issuer.subject}".`);
    }
    if (!(await cert.verify({ publicKey: issuer, signatureOnly: true }))) {
      throw new Error(`x5c[${i}] (${describe(cert)}) is not signed by x5c[${i + 1}] (${describe(issuer)}).`);
    }
  }

  const top = chain[chain.length - 1];
  const pinned = roots.some((r) => sameDer(r, top));
  if (!pinned) {
    let signedByRoot = false;
    for (const r of roots) {
      if (top.issuer === r.subject && (await top.verify({ publicKey: r, signatureOnly: true }))) { signedByRoot = true; break; }
    }
    if (!signedByRoot) {
      throw new Error(`The chain ends at "${describe(top)}", which is not the trusted root${opts.apple ? ' (Apple Root CA - G3)' : ''} and is not signed by it.`);
    }
  }

  if (opts.apple) {
    if (!chain[0].getExtension(APPLE_LEAF_OID)) {
      throw new Error(`The leaf certificate lacks Apple's App Store signing marker (OID ${APPLE_LEAF_OID}).`);
    }
    if (!chain[1].getExtension(APPLE_INTERMEDIATE_OID)) {
      throw new Error(`The intermediate certificate lacks Apple's WWDR marker (OID ${APPLE_INTERMEDIATE_OID}).`);
    }
  }
}
