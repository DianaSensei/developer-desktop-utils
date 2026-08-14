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

import CryptoJS from 'crypto-js';
import * as uuid from 'uuid';
import _ from 'lodash';
import { jwtDecode } from 'jwt-decode';
import dayjs from 'dayjs';

const MODULES: Record<string, unknown> = {
  'crypto-js': CryptoJS,
  uuid,
  lodash: _,
  'jwt-decode': { jwtDecode },
  dayjs,
  // common aliases
  'crypto-js/crypto-js': CryptoJS,
};

export function requireModule(name: string): unknown {
  if (name in MODULES) return MODULES[name];
  throw new Error(
    `require('${name}') is not available. Bundled modules: ${Object.keys(MODULES)
      .filter((m) => !m.includes('/'))
      .join(', ')}`,
  );
}
