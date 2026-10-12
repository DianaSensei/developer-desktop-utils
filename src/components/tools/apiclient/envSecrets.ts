import type { Environment } from './types';

/**
 * Moves the values of `secret` environment variables into the encrypted
 * secret store. Everything else (names, base URLs, plain variables) stays in
 * the regular store, which other parts of the app read synchronously.
 */

/** Store key for one variable; variable ids are only unique per environment. */
export function envSecretKey(envId: string, varId: string): string {
  return `${envId}:${varId}`;
}

export type EnvSecretMap = Record<string, string>;

/**
 * Returns the environments with secret values stripped, plus the full secret
 * map. The map is complete (not a patch), so un-marking a variable or deleting
 * an environment drops its stale entry from the store.
 */
export function splitEnvSecrets(environments: Environment[]): {
  stripped: Environment[];
  secrets: EnvSecretMap;
} {
  const secrets: EnvSecretMap = {};
  const stripped = environments.map((env) => ({
    ...env,
    variables: env.variables.map((v) => {
      if (!v.secret) return v;
      if (v.value !== '') secrets[envSecretKey(env.id, v.id)] = v.value;
      return { ...v, value: '' };
    }),
  }));
  return { stripped, secrets };
}

/** Puts secret values back so the rest of the app sees complete environments. */
export function mergeEnvSecrets(stripped: Environment[], secrets: EnvSecretMap): Environment[] {
  return stripped.map((env) => ({
    ...env,
    variables: env.variables.map((v) =>
      v.secret ? { ...v, value: secrets[envSecretKey(env.id, v.id)] ?? v.value } : v,
    ),
  }));
}

/** True if any secret value is still stored inline (needs a one-time migration). */
export function hasInlineEnvSecrets(environments: Environment[]): boolean {
  return environments.some((env) => env.variables.some((v) => v.secret && v.value !== ''));
}
