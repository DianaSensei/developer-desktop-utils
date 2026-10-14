import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import { useSecretState, type PluginSdk } from '@/platform';
import { hasInlineEnvSecrets, mergeEnvSecrets, splitEnvSecrets, type EnvSecretMap } from './envSecrets';
import type { Environment } from './types';

/**
 * `environments` whose `secret` values live in the encrypted secret store and
 * everything else in the regular store. Callers see merged environments and a
 * `setEnvironments` with the same updater API as `usePersistentState`. The
 * regular storage is passed in so store.ts keeps owning all of its keys.
 */
export function useEnvSecrets(
  sdk: PluginSdk,
  stripped: Environment[],
  setStripped: Dispatch<SetStateAction<Environment[]>>,
): [Environment[], Dispatch<SetStateAction<Environment[]>>, boolean] {
  const [secrets, setSecrets, ready] = useSecretState<EnvSecretMap>(sdk, 'envSecrets', {});

  const environments = useMemo(() => mergeEnvSecrets(stripped, secrets), [stripped, secrets]);

  const environmentsRef = useRef(environments);
  environmentsRef.current = environments;

  const setEnvironments = useCallback<Dispatch<SetStateAction<Environment[]>>>(
    (action) => {
      const next =
        typeof action === 'function'
          ? (action as (prev: Environment[]) => Environment[])(environmentsRef.current)
          : action;
      // Advance the ref now: a second call in the same tick (a script writing
      // the collection env and then the global env, MCP add_environment then
      // update) must build on this result, not on the last render, or it
      // silently undoes it.
      environmentsRef.current = next;
      const split = splitEnvSecrets(next);
      setStripped(split.stripped);
      setSecrets(split.secrets);
    },
    [setStripped, setSecrets],
  );

  useEffect(() => {
    // One-time migration of secrets stored inline by older versions. Runs only
    // after the secret store has loaded; earlier would overwrite real secrets
    // with an empty map.
    if (!ready) return;
    if (!hasInlineEnvSecrets(stripped)) return;

    const split = splitEnvSecrets(stripped);
    setStripped(split.stripped);
    // Merge, don't replace: values already in the store are newer than inline leftovers.
    setSecrets((prev) => ({ ...split.secrets, ...prev }));
  }, [ready, stripped, setStripped, setSecrets]);

  return [environments, setEnvironments, ready];
}
