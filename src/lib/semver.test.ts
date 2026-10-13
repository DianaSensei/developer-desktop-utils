import { describe, expect, it } from 'vitest';
import { compareVersions, isPrerelease } from '@/lib/semver';

const sign = (n: number) => Math.sign(n);

describe('compareVersions', () => {
  it('orders plain versions numerically', () => {
    expect(sign(compareVersions('1.10.0', '1.9.0'))).toBe(1);
    expect(sign(compareVersions('1.2', '1.2.0'))).toBe(0);
    expect(sign(compareVersions('2.0.0', '10.0.0'))).toBe(-1);
  });

  it('orders prereleases below their release', () => {
    expect(sign(compareVersions('1.1.0', '1.1.0-beta.1'))).toBe(1);
    expect(sign(compareVersions('1.1.0-beta.1', '1.1.0'))).toBe(-1);
    expect(sign(compareVersions('1.2.0-beta.1', '1.1.0'))).toBe(1);
  });

  it('orders prerelease identifiers per semver', () => {
    expect(sign(compareVersions('1.1.0-beta.2', '1.1.0-beta.1'))).toBe(1);
    expect(sign(compareVersions('1.1.0-beta.10', '1.1.0-beta.2'))).toBe(1);
    expect(sign(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'))).toBe(-1);
    expect(sign(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta'))).toBe(-1);
    expect(sign(compareVersions('1.0.0-beta', '1.0.0-alpha'))).toBe(1);
    expect(sign(compareVersions('1.0.0-rc.1', '1.0.0-rc.1'))).toBe(0);
  });

  it('ignores build metadata and a leading v', () => {
    expect(sign(compareVersions('1.0.0+build.5', '1.0.0+build.1'))).toBe(0);
    expect(sign(compareVersions('v1.2.0', '1.2.0'))).toBe(0);
  });
});

describe('isPrerelease', () => {
  it('detects a prerelease tag', () => {
    expect(isPrerelease('1.1.0-beta.1')).toBe(true);
    expect(isPrerelease('1.1.0')).toBe(false);
    expect(isPrerelease('1.1.0+build.1')).toBe(false);
  });
});
