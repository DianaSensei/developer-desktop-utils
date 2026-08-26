import { useCallback, useEffect, useState } from 'react';
import { containerApi, type ContainerConnection, type ContainerSummary } from './types';

/**
 * "Is this image / volume / network actually being used, and by what?"
 *
 * Docker has no endpoint that answers this per resource — the CLI works it out
 * the same way, by walking the container list. Every container summary already
 * carries its image id, its mounts and its attached networks, so one
 * `container_list(all)` call is enough to index all three at once; inspecting
 * each image, volume and network individually would be dozens of round trips
 * for the same answer.
 *
 * Names are kept alongside the counts because "used by 3 containers" is much
 * less useful than being able to point at which three.
 */
export interface UsageIndex {
  /** Keyed by full image id (`sha256:…`) — matches ImageSummary.Id. */
  byImage: Map<string, string[]>;
  /** Keyed by volume name, from each container's named mounts. */
  byVolume: Map<string, string[]>;
  /** Keyed by network name. */
  byNetwork: Map<string, string[]>;
}

export const EMPTY_USAGE: UsageIndex = { byImage: new Map(), byVolume: new Map(), byNetwork: new Map() };

function containerName(c: ContainerSummary): string {
  return c.Names?.[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12);
}

export function buildUsageIndex(containers: ContainerSummary[]): UsageIndex {
  const index: UsageIndex = { byImage: new Map(), byVolume: new Map(), byNetwork: new Map() };
  const push = (map: Map<string, string[]>, key: string, name: string) => {
    const list = map.get(key);
    if (list) list.push(name);
    else map.set(key, [name]);
  };

  for (const c of containers) {
    const name = containerName(c);
    if (c.ImageID) push(index.byImage, c.ImageID, name);
    for (const m of c.Mounts ?? []) {
      // Only named volumes are addressable in the Volumes view — bind mounts
      // have a host path instead of a name and nothing to match against.
      if (m.Type === 'volume' && m.Name) push(index.byVolume, m.Name, name);
    }
    for (const netName of Object.keys(c.NetworkSettings?.Networks ?? {})) {
      push(index.byNetwork, netName, name);
    }
  }
  return index;
}

/**
 * Loads the container list and indexes it. Kept separate from each view's own
 * data load so a slow or failed usage lookup never blocks or breaks the list
 * itself — on failure the index is simply empty and the "In use" columns fall
 * back to showing nothing.
 *
 * `reload` is returned rather than only keyed off `refreshKey` because the
 * views reload themselves after their own mutations (a prune, a removal)
 * without going through the toolbar's refresh — and a stale "in use by 3
 * containers" next to a freshly emptied list is worse than no column at all.
 */
export function useUsageIndex(connection: ContainerConnection, refreshKey: number): {
  usage: UsageIndex;
  reload: () => void;
} {
  const [usage, setUsage] = useState<UsageIndex>(EMPTY_USAGE);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    containerApi.list(connection, true)
      .then((cs) => { if (!cancelled) setUsage(buildUsageIndex(cs)); })
      .catch(() => { if (!cancelled) setUsage(EMPTY_USAGE); });
    return () => { cancelled = true; };
  }, [connection, refreshKey, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { usage, reload };
}

/** "nginx-1, redis-cache +2 more" — the tooltip body for an In-use cell. */
export function describeUsers(names: string[] | undefined, max = 4): string {
  if (!names || names.length === 0) return 'Not used by any container';
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} +${names.length - max} more` : shown;
}
