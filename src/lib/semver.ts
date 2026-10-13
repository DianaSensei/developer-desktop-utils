// Semver precedence (semver.org §11) for plugin versions, which may carry a
// prerelease tag now that a market entry can publish a beta build.

interface ParsedVersion {
  core: number[];
  pre: string[];
}

function parse(version: string): ParsedVersion {
  // Build metadata (`+...`) never affects precedence.
  const [main] = version.trim().replace(/^v/, '').split('+');
  const dash = main.indexOf('-');
  const coreText = dash === -1 ? main : main.slice(0, dash);
  const preText = dash === -1 ? '' : main.slice(dash + 1);
  return {
    core: coreText.split('.').map((n) => Number.parseInt(n, 10) || 0),
    pre: preText ? preText.split('.') : [],
  };
}

const NUMERIC = /^\d+$/;

function comparePrereleaseId(a: string, b: string): number {
  const aNum = NUMERIC.test(a);
  const bNum = NUMERIC.test(b);
  if (aNum && bNum) return Number(a) - Number(b);
  // Numeric identifiers sort before alphanumeric ones.
  if (aNum !== bNum) return aNum ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Negative if `a` < `b`, positive if `a` > `b`, 0 if they have equal
 *  precedence. `1.1.0-beta.1` < `1.1.0-beta.2` < `1.1.0`. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.core.length, pb.core.length); i++) {
    const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // A version without a prerelease tag ranks above one with it.
  if (pa.pre.length === 0 || pb.pre.length === 0) return pb.pre.length - pa.pre.length;
  for (let i = 0; i < Math.min(pa.pre.length, pb.pre.length); i++) {
    const diff = comparePrereleaseId(pa.pre[i], pb.pre[i]);
    if (diff !== 0) return diff;
  }
  return pa.pre.length - pb.pre.length;
}

/** `true` for versions with a prerelease tag, e.g. `1.2.0-beta.1`. */
export function isPrerelease(version: string): boolean {
  return parse(version).pre.length > 0;
}
