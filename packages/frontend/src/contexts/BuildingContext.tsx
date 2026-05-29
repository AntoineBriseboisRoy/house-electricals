import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Building } from '@he/shared';
import {
  createBuilding as apiCreateBuilding,
  deleteBuilding as apiDeleteBuilding,
  listBuildings,
  setActiveBuildingId,
  updateBuilding as apiUpdateBuilding,
} from '../api.js';

/**
 * Multi-building layer (2026-05). The top of the hierarchy: panels, floors,
 * and components all belong to a building. This context owns the building
 * LIST + the ACTIVE selection (persisted to localStorage). The selection is
 * mirrored into the api client via `setActiveBuildingId`, so every
 * list/create call is auto-scoped to the active building — no need to thread
 * the id through individual screens.
 *
 * Mounted INSIDE the authed tree (the /buildings endpoint is auth-gated). It
 * gates rendering on a one-time load so the api scope is set before any
 * screen fetches. The backend always seeds a default "My House", so there is
 * always at least one building to select.
 */

const STORAGE_KEY = 'he.current-building';

type BuildingContextValue = {
  phase: 'loading' | 'ready';
  buildings: Building[];
  currentBuildingId: string | null;
  currentBuilding: Building | null;
  switchBuilding: (id: string) => void;
  createBuilding: (name: string) => Promise<Building>;
  renameBuilding: (id: string, name: string) => Promise<void>;
  deleteBuilding: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const BuildingContext = createContext<BuildingContextValue | null>(null);

const readStored = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

export const BuildingProvider = ({
  children,
}: {
  children: ReactNode;
}): JSX.Element => {
  const [phase, setPhase] = useState<'loading' | 'ready'>('loading');
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [currentBuildingId, setCurrentBuildingId] = useState<string | null>(null);

  /** Set the active building everywhere: the api scope (sync, module-level,
   *  so the very next fetch is scoped), local state, and localStorage. */
  const applyActive = useCallback((id: string | null): void => {
    setActiveBuildingId(id);
    setCurrentBuildingId(id);
    if (id !== null) {
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // ignore storage failures (private mode etc.)
      }
    }
  }, []);

  const load = useCallback(async (): Promise<void> => {
    const list = await listBuildings();
    setBuildings(list);
    const stored = readStored();
    const valid =
      list.some((b) => b.id === stored) && stored !== null
        ? stored
        : (list[0]?.id ?? null);
    applyActive(valid);
  }, [applyActive]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await load();
      } catch {
        // Fail open — leave the scope unset; screens will still render and
        // the user can retry. (A transient backend hiccup shouldn't wedge
        // the whole app.)
      } finally {
        if (!cancelled) setPhase('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const switchBuilding = useCallback(
    (id: string): void => {
      applyActive(id);
    },
    [applyActive]
  );

  const createBuilding = useCallback(
    async (name: string): Promise<Building> => {
      const b = await apiCreateBuilding({ name });
      setBuildings((prev) => [...prev, b]);
      applyActive(b.id); // jump into the new building
      return b;
    },
    [applyActive]
  );

  const renameBuilding = useCallback(
    async (id: string, name: string): Promise<void> => {
      const updated = await apiUpdateBuilding(id, { name });
      setBuildings((prev) => prev.map((b) => (b.id === id ? updated : b)));
    },
    []
  );

  const deleteBuilding = useCallback(
    async (id: string): Promise<void> => {
      await apiDeleteBuilding(id);
      const remaining = buildings.filter((b) => b.id !== id);
      setBuildings(remaining);
      if (id === currentBuildingId) {
        applyActive(remaining[0]?.id ?? null);
      }
    },
    [applyActive, buildings, currentBuildingId]
  );

  const currentBuilding = useMemo(
    () => buildings.find((b) => b.id === currentBuildingId) ?? null,
    [buildings, currentBuildingId]
  );

  const value: BuildingContextValue = {
    phase,
    buildings,
    currentBuildingId,
    currentBuilding,
    switchBuilding,
    createBuilding,
    renameBuilding,
    deleteBuilding,
    refresh: load,
  };

  return (
    <BuildingContext.Provider value={value}>{children}</BuildingContext.Provider>
  );
};

export const useBuilding = (): BuildingContextValue => {
  const ctx = useContext(BuildingContext);
  if (ctx === null) {
    throw new Error('useBuilding() must be used inside <BuildingProvider>.');
  }
  return ctx;
};
