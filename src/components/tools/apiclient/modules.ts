// Modules available to scripts via require(), Bruno-style.
//
// Bruno lets scripts `require()` a set of bundled libraries. We expose the ones
// already (or now) shipped with the app. These are statically imported, so they
// land in the lazily-loaded API Client chunk — nothing extra at app startup.
//
// This list is deliberately small and curated (never "require(anything)"):
// each addition is a real dependency, reviewed for bundle size, so the
// scripting surface stays auditable. `jwt-decode` and `dayjs` were added for
// two of the most common Postman/Bruno script needs — inspecting a bearer
// token and doing date math — that scripts had no way to do before. `dayjs`
// (not the already-present `date-fns`) specifically because `require()` has
// to hand back the *whole* module object, which defeats date-fns's
// named-import tree-shaking; dayjs stays tiny (~2 KB) even imported whole.
//
// `jose` and `jsonwebtoken` cover *signing*, not just decoding: generating
// JWS/JWT signatures (HMAC HS256/384/512, RSA RS256/384/512 and PS256/384/512,
// ECDSA ES256/384/512, EdDSA). Both run on the Web Crypto API
// (`crypto.subtle`) — no Node polyfill, works in this app's webview and in
// the web build. `jose` is exposed as-is; `jsonwebtoken` is a same-API shim
// over `jose` (see jsonwebtokenShim.ts) since the *real* `jsonwebtoken`
// package is Node-only (`crypto`/`Buffer`) and cannot run here at all —
// unlike Postman/Bruno, whose desktop apps are Electron and so really do
// have a Node.js process behind their sandbox, this app's webview has none.

import CryptoJS from 'crypto-js';
import * as uuid from 'uuid';
import _ from 'lodash';
import { jwtDecode } from 'jwt-decode';
import dayjs from 'dayjs';
import * as jose from 'jose';
import jsonwebtoken from './jsonwebtokenShim';

const MODULES: Record<string, unknown> = {
  'crypto-js': CryptoJS,
  uuid,
  lodash: _,
  'jwt-decode': { jwtDecode },
  dayjs,
  jose,
  // Real `jsonwebtoken` is Node-only (crypto/Buffer) and can't run in this
  // app's webview — this is a same-API shim built on `jose`'s Web Crypto
  // signing (HS/RS/PS/ES/EdDSA). See jsonwebtokenShim.ts for the two
  // deliberate differences (sign/verify are async; verify requires
  // `algorithms` to be named explicitly).
  jsonwebtoken,
  // common aliases
  'crypto-js/crypto-js': CryptoJS,
};

export function requireModule(name: string): unknown {
  // `MODULES` is a plain object, so a bare `name in MODULES` resolves against
  // Object.prototype too: require('constructor') returned the live Object
  // constructor, require('__proto__') returned Object.prototype itself — a
  // script that came from an imported collection getting a reflection handle
  // it was never meant to have, out of what looks like an ordinary "module
  // not found" check. `require` is exposed straight to scripts (see
  // runtime.ts), so this was directly reachable, not just an internal detail.
  if (Object.prototype.hasOwnProperty.call(MODULES, name)) return MODULES[name];
  throw new Error(
    `require('${name}') is not available. Bundled modules: ${Object.keys(MODULES)
      .filter((m) => !m.includes('/'))
      .join(', ')}`,
  );
}
