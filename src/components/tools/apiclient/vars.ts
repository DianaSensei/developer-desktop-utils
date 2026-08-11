// {{variable}} substitution.
//
// Split out of request.ts so the scripting sandbox can use it without pulling
// the whole HTTP layer (and the Tauri plugin import it lazily loads) into the
// worker bundle.

import type { VarMap } from './types';

// Replace every {{name}} token using the supplied variable map. Unknown tokens
// are left as-is so the user can see what didn't resolve.
export function substituteVars(text: string, vars: VarMap): string {
  if (!text) return text;
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name: string) =>
    name in vars ? vars[name] : whole,
  );
}
