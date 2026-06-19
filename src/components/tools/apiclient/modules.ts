// Modules available to scripts via require(), Bruno-style.
//
// Bruno lets scripts `require()` a set of bundled libraries. We expose the ones
// already (or now) shipped with the app. These are statically imported, so they
// land in the lazily-loaded API Client chunk — nothing extra at app startup.

import CryptoJS from 'crypto-js';
import * as uuid from 'uuid';
import _ from 'lodash';

const MODULES: Record<string, unknown> = {
  'crypto-js': CryptoJS,
  uuid,
  lodash: _,
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
