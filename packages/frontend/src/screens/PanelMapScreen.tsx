import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useRoute } from 'wouter';
import { Upload, Trash2, Zap, Layers, Pencil, X } from 'lucide-react';
import type {
  Breaker,
  ComponentInput,
  Floor,
  Panel,
  ResolvedComponent,
  Room,
  Wall,
} from '@he/shared';
import {
  ApiHttpError,
  createRoom,
  createWall,
  deleteComponent,
  deleteFloorPlan,
  deleteRoom,
  deleteWall,
  floorPlanUrl,
  getPanel,
  listAllBreakersGrouped,
  listBreakers,
  listComponents,
  listFloors,
  listRooms,
  listWalls,
  updateRoom,
  updateWall,
  uploadFloorPlan,
  updateComponent,
  type PanelWithBreakers,
} from '../api.js';
import { suffixDuplicate } from '../lib/duplicateName.js';
import { ComponentTypeIcon, componentTypeLabel } from '../components/ComponentTypeIcon.js';
import { useMapDrag, type DropResult } from '../hooks/useMapDrag.js';
import { useMultiSelect } from '../hooks/useMultiSelect.js';
import { useOptimisticPatch } from '../hooks/useOptimisticPatch.js';
import { useToastSink } from '../hooks/useToastSink.js';
import { useUndoableDelete } from '../hooks/useUndoableDelete.js';
import { useWallEditor, type Point } from '../hooks/useWallEditor.js';
import { useRoomEditor, rectFromCorners, type Corner } from '../hooks/useRoomEditor.js';
import {
  Button,
  Card,
  CardTitle,
  Checkbox,
  EmptyState,
  FloorPlanVectorOverlay,
  IconButton,
  NoFloors,
  PanelVisualization,
  ScreenHeader,
  SelectionBar,
  Skeleton,
  toast,
} from '../ui/index.js';
import { useModal } from '../hooks/useModal.js';
import { findRoomForPoint } from '../lib/roomLookup.js';

/** Sentinel for the "All floors" segmented-control option. */
const ALL_FLOORS = '__all__' as const;
type FloorSelection = string | typeof ALL_FLOORS;

const readFloorFromUrl = (): string | null => {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('floor');
};

const sortFloors = (a: Floor, b: Floor): number => {
  const aOrder = a.displayOrder;
  const bOrder = b.displayOrder;
  if (aOrder !== null && bOrder !== null) {
    if (aOrder !== bOrder) return aOrder - bOrder;
  } else if (aOrder !== null) {
    return -1;
  } else if (bOrder !== null) {
    return 1;
  }
  return a.createdAt - b.createdAt;
};

export const PanelMapScreen = (): JSX.Element => {
  const [, params] = useRoute<{ id: string }>('/panels/:id/map');
  const panelId = params?.id ?? '';
  const [, setLocation] = useLocation();

  const [panel, setPanel] = useState<Panel | null>(null);
  const [breakers, setBreakers] = useState<Breaker[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [components, setComponents] = useState<ResolvedComponent[]>([]);
  const [walls, setWalls] = useState<Wall[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  /** G42(f) cycle-51 — all panels' breakers grouped, so the Unplaced-bulk
   *  "Assign breaker" picker can offer cross-panel options. Re-fetched on
   *  every `refresh()` so newly-added breakers show up. */
  const [breakerGroups, setBreakerGroups] = useState<PanelWithBreakers[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [selection, setSelection] = useState<FloorSelection | null>(null);
  /** G12 tool mode — 'pin' (default) | 'walls' | 'rooms'. Mutually exclusive. */
  const [tool, setTool] = useState<'pin' | 'walls' | 'rooms'>('pin');
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  /** Derived for backward-compat references throughout the screen. */
  const editingWalls = tool === 'walls';
  const editingRooms = tool === 'rooms';

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);

  const { confirm, pick, prompt, modalNode } = useModal();
  const { deleteManyWithUndo } = useUndoableDelete();

  const optimistic = useOptimisticPatch<Partial<ComponentInput>, unknown>((id, body) =>
    updateComponent(id, body)
  );
  useToastSink(optimistic.errors);
  /** G42(f) cycle-51 — separate optimistic-patch queue for bulk breaker
   *  assigns from the Unplaced sidebar. Sibling to the move-pin `optimistic`
   *  queue so the two surfaces' pending sets don't collide. */
  const bulkAssign = useOptimisticPatch(
    async (id: string, body: { breakerId: string | null }) => {
      return updateComponent(id, body);
    }
  );

  const refresh = useCallback(async () => {
    if (!panelId) return;
    setLoading(true);
    try {
      const [p, breakersList, allComponents, allFloors, groups] = await Promise.all([
        getPanel(panelId),
        listBreakers(panelId),
        listComponents(),
        listFloors(),
        listAllBreakersGrouped(),
      ]);
      setPanel(p);
      setBreakers(breakersList);
      const breakerIds = new Set(breakersList.map((b) => b.id));
      const onThisPanel = allComponents.filter(
        (c) => c.breakerId !== null && breakerIds.has(c.breakerId)
      );
      setComponents(onThisPanel);
      setFloors(allFloors.slice().sort(sortFloors));
      setBreakerGroups(groups);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load panel.');
    } finally {
      setLoading(false);
    }
  }, [panelId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Floors that have at least one component on THIS panel's breakers — placeholder — the
  // segmented control surfaces only these (plus "All floors" when ≥2 qualify).
  // G16 cycle-15 update: the switcher surfaces (a) floors with ≥1 component
  // on this panel's breakers AND (b) any floor explicitly referenced by the
  // `?floor=<id>` URL param — so a deep link to an empty referenced floor
  // doesn't silently fall through to a different floor. Pinned in CLAUDE.md
  // "Multi-floor model (G13)" → switcher inclusion rule.
  const qualifyingFloors = useMemo(() => {
    const ids = new Set(
      components
        .map((c) => c.floorId)
        .filter((id): id is string => id !== null)
    );
    // Augment with the URL-referenced floor if it exists in the floors list.
    const urlFloor = readFloorFromUrl();
    if (urlFloor !== null && urlFloor !== ALL_FLOORS) {
      ids.add(urlFloor);
    }
    return floors.filter((f) => ids.has(f.id));
  }, [components, floors]);

  // Pick the initial selection: ?floor= param if it points at a known floor
  // (now includes empty referenced floors per the rule above), otherwise the
  // first qualifying floor; or null if nothing qualifies.
  useEffect(() => {
    if (loading) return;
    if (selection !== null) return;
    const fromUrl = readFloorFromUrl();
    if (
      fromUrl !== null &&
      (fromUrl === ALL_FLOORS || qualifyingFloors.some((f) => f.id === fromUrl))
    ) {
      setSelection(fromUrl);
      return;
    }
    const first = qualifyingFloors[0];
    setSelection(first ? first.id : null);
  }, [loading, qualifyingFloors, selection]);

  // When `selection` changes, push it into the URL (?floor=...) so back/fwd
  // works and deep-links survive. Use replace:true so navigation history
  // doesn't bloat as the user clicks.
  useEffect(() => {
    if (selection === null) return;
    const sp = new URLSearchParams(window.location.search);
    sp.set('floor', selection);
    setLocation(`/panels/${panelId}/map?${sp.toString()}`, { replace: true });
  }, [selection, panelId, setLocation]);

  const activeFloor = useMemo<Floor | null>(() => {
    if (selection === null || selection === ALL_FLOORS) return null;
    return floors.find((f) => f.id === selection) ?? null;
  }, [floors, selection]);

  // Fetch walls + rooms whenever the active floor changes (single-floor only).
  // "All floors" doesn't show walls/rooms — they're per-floor; the editor
  // needs an unambiguous host floor.
  useEffect(() => {
    if (activeFloor === null) {
      setWalls([]);
      setRooms([]);
      return;
    }
    void Promise.all([listWalls(activeFloor.id), listRooms(activeFloor.id)])
      .then(([w, r]) => {
        setWalls(w);
        setRooms(r);
      })
      .catch((e: unknown) => {
        toast.error(
          e instanceof Error ? e.message : 'Failed to load floor geometry.'
        );
      });
  }, [activeFloor]);

  // "Placed" = has floor_id matching the current view AND posX/posY. When the
  // user picks "All floors", placed = anything with posX/posY on this panel.
  // "Unplaced" = on this panel but not placed under the current view.
  const placed = useMemo(() => {
    return components.filter((c) => {
      if (c.posX === null || c.posY === null) return false;
      if (selection === ALL_FLOORS) return true;
      return c.floorId === selection;
    });
  }, [components, selection]);

  const unplaced = useMemo(() => {
    return components.filter((c) => {
      if (c.posX === null || c.posY === null) return true;
      if (selection === ALL_FLOORS) return false;
      return c.floorId !== selection;
    });
  }, [components, selection]);

  // G42(f) cycle-51 — multi-select state scoped to the current Unplaced list.
  // Auto-prunes when items leave the list (e.g. a row gets placed via drag,
  // moving it out of `unplaced`).
  const ms = useMultiSelect(unplaced);

  // G42(f) cycle-51 — bulk delete with confirm + batched undo. Mirrors the
  // cycle-50 ComponentsScreen surface; the optimistic removal targets the
  // top-level `components` state (so the row disappears from Unplaced AND
  // anywhere else it might appear).
  const handleBulkDelete = useCallback(async (): Promise<void> => {
    const selected = ms.selectedItems;
    if (selected.length === 0) return;
    const ok = await confirm({
      title: `Delete ${selected.length} component${selected.length === 1 ? '' : 's'}?`,
      message:
        selected.length === 1
          ? `"${selected[0].name}" will be removed. You'll have 30 seconds to undo.`
          : `${selected.length} components will be removed. You'll have 30 seconds to undo.`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    const prevList = components;
    const ids = selected.map((c) => c.id);
    const idSet = new Set(ids);
    deleteManyWithUndo({
      entries: selected.map((c) => ({
        id: c.id,
        resourceType: 'component',
        label: c.name,
        commit: async () => {
          await deleteComponent(c.id);
        },
      })),
      removeOptimistically: () => {
        setComponents((cur) => cur.filter((c) => !idSet.has(c.id)));
        ms.clear();
      },
      restore: () => {
        setComponents(prevList);
      },
      resourceNamePlural:
        selected.length === 1 ? 'component' : 'components',
    });
  }, [components, confirm, deleteManyWithUndo, ms]);

  // G42(f) cycle-51 — bulk assign breaker via N PATCHes (NO backend bulk
  // endpoint, per the cycle-50 OBJ1 pin). Reuses the same picker shape
  // ComponentsScreen offers, sourcing options from `breakerGroups` so the
  // user can also pick a breaker on a different panel.
  const handleBulkAssign = useCallback(async (): Promise<void> => {
    const selected = ms.selectedItems;
    if (selected.length === 0) return;
    type Option = { value: string | null; label: string; hint?: string };
    const options: Option[] = [
      { value: null, label: 'Unassigned', hint: 'Clear the breaker on all selected' },
    ];
    for (const { panel: p, breakers: bs } of breakerGroups) {
      for (const b of bs) {
        const pos = b.slotPosition !== null ? `slot ${b.slotPosition}` : '';
        const half =
          b.poles === 'tandem' && b.tandemHalf !== null ? b.tandemHalf : '';
        const slot = pos ? `${pos}${half} · ` : '';
        options.push({
          value: b.id,
          label: `${slot}${b.label} · ${b.amperage}A`,
          hint: p.name,
        });
      }
    }
    const picked = await pick<string | null>({
      title: `Assign breaker for ${selected.length} component${selected.length === 1 ? '' : 's'}`,
      message:
        selected.length === 1
          ? `Choose a breaker to wire "${selected[0].name}" to, or pick "Unassigned" to clear.`
          : `Choose a breaker to wire all ${selected.length} components to, or pick "Unassigned" to clear.`,
      options,
      emptyMessage: 'No breakers available — add a panel + breakers first.',
    });
    if (picked === null) return;
    // Resolve the picked breaker's chip for the optimistic update.
    let resolvedBreaker: ResolvedComponent['breaker'] = null;
    if (picked !== null) {
      for (const { panel: p, breakers: bs } of breakerGroups) {
        const b = bs.find((x) => x.id === picked);
        if (b !== undefined) {
          resolvedBreaker = {
            id: b.id,
            label: b.label,
            slot: b.slot,
            slotPosition: b.slotPosition,
            poles: b.poles,
            tandemHalf: b.tandemHalf ?? null,
            amperage: b.amperage,
            panelId: p.id,
            panelName: p.name,
          };
          break;
        }
      }
    }
    const targetIds = selected.map((c) => c.id);
    const targetIdSet = new Set(targetIds);
    setComponents((cur) =>
      cur.map((c) =>
        targetIdSet.has(c.id)
          ? { ...c, breakerId: picked, breaker: resolvedBreaker }
          : c
      )
    );
    const results = await Promise.allSettled(
      targetIds.map((id) => bulkAssign.patch(id, { breakerId: picked }))
    );
    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected'
    );
    const nullResults = results.filter(
      (r) => r.status === 'fulfilled' && r.value === null
    );
    const totalFailures = failures.length + nullResults.length;
    if (totalFailures === 0) {
      toast.success(
        `Assigned ${targetIds.length} component${targetIds.length === 1 ? '' : 's'}.`
      );
      ms.clear();
      void refresh();
    } else if (totalFailures === targetIds.length) {
      toast.error(`Failed to assign breaker on ${targetIds.length} components.`);
      void refresh();
    } else {
      toast.error(
        `${totalFailures} of ${targetIds.length} components failed to assign.`
      );
      ms.clear();
      void refresh();
    }
  }, [breakerGroups, bulkAssign, ms, pick, refresh]);

  // Memoized SelectionBar actions — kept stable so the bar doesn't re-render
  // its action buttons on every parent render.
  const selectionActions = useMemo(
    () => (
      <>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void handleBulkAssign();
          }}
          data-testid="bulk-assign"
        >
          Assign breaker
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            void handleBulkDelete();
          }}
          data-testid="bulk-delete"
        >
          Delete
        </Button>
      </>
    ),
    [handleBulkAssign, handleBulkDelete]
  );

  // Hash-scroll for deep links from /components ("View on map" -> #pin-<id>).
  // Runs AFTER load (so the pin element is in the DOM) and AFTER `placed`
  // changes (so the right pins exist for the active floor). Uses
  // data-highlight + the existing he-pulse keyframe for visual pulse.
  useEffect(() => {
    if (loading) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#pin-')) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.setAttribute('data-highlight', 'true');
    setSelectedComponentId(hash.slice('#pin-'.length));
    const t = setTimeout(() => el.removeAttribute('data-highlight'), 1500);
    return () => clearTimeout(t);
  }, [loading, placed]);

  const handleDrop = useCallback(
    async (componentId: string, drop: DropResult): Promise<void> => {
      if (drop === null) return;
      if (selection === null || selection === ALL_FLOORS) {
        // No specific floor selected — refuse to drop. The UX path: pick a
        // floor first. This is rare because the segmented control hides when
        // no floors qualify and `All floors` is opt-in.
        toast.error('Pick a single floor before placing a component.');
        return;
      }
      const floorId = selection;
      // G26 — auto-bind: if the drop point lands inside an existing
      // room on this floor and the component has no manually-set room
      // (room === null), assign the room name in the same PATCH. If the
      // user has already set a room manually, we do NOT overwrite it.
      const existing = components.find((c) => c.id === componentId);
      const containingRoom = findRoomForPoint(rooms, drop.x, drop.y);
      const resolvedRoom: string | null | undefined =
        existing && existing.room !== null
          ? undefined // keep user's manual room
          : containingRoom?.name ?? null;

      // Optimistic local move: update the component's posX/posY/floor_id.
      setComponents((prev) =>
        prev.map((c) =>
          c.id === componentId
            ? {
                ...c,
                posX: drop.x,
                posY: drop.y,
                floorId,
                room: resolvedRoom === undefined ? c.room : resolvedRoom,
              }
            : c
        )
      );
      setSelectedComponentId(componentId);

      const patch: {
        posX: number;
        posY: number;
        floorId: string;
        room?: string | null;
      } = {
        posX: drop.x,
        posY: drop.y,
        floorId,
      };
      if (resolvedRoom !== undefined) patch.room = resolvedRoom;
      const result = await optimistic.patch(componentId, patch);
      if (result === null) {
        await refresh();
      }
    },
    [optimistic, refresh, selection, components, rooms]
  );

  const { drag, handlersFor } = useMapDrag({ mapRef, onDrop: handleDrop });

  // G12 wall editor — two-tap state machine + endpoint dragging. Active only
  // when editingWalls is true AND a single floor is selected. The hook
  // handles ESC + reset on deactivation.
  const wallEditor = useWallEditor({
    containerRef: mapRef,
    active: editingWalls && activeFloor !== null,
    onCommit: async (start, end) => {
      if (activeFloor === null) return;
      // Skip zero-length walls (both endpoints identical post-snap).
      if (start.x === end.x && start.y === end.y) return;
      const tempId = `tmp-${Date.now()}`;
      const optimistic: Wall = {
        id: tempId,
        floorId: activeFloor.id,
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        createdAt: Date.now(),
      };
      setWalls((prev) => [...prev, optimistic]);
      try {
        const real = await createWall(activeFloor.id, {
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
        });
        setWalls((prev) => prev.map((w) => (w.id === tempId ? real : w)));
      } catch (err) {
        setWalls((prev) => prev.filter((w) => w.id !== tempId));
        toast.error(err instanceof Error ? err.message : 'Failed to add wall.');
      }
    },
    onEndpointCommit: async (wallId, endpoint, point) => {
      const before = walls.find((w) => w.id === wallId);
      if (!before) return;
      // Optimistic local update: place the dragged endpoint at the snapped pt.
      setWalls((prev) =>
        prev.map((w) =>
          w.id === wallId
            ? endpoint === 1
              ? { ...w, x1: point.x, y1: point.y }
              : { ...w, x2: point.x, y2: point.y }
            : w
        )
      );
      try {
        await updateWall(
          wallId,
          endpoint === 1
            ? { x1: point.x, y1: point.y }
            : { x2: point.x, y2: point.y }
        );
      } catch (err) {
        // Rollback on failure.
        setWalls((prev) => prev.map((w) => (w.id === wallId ? before : w)));
        toast.error(err instanceof Error ? err.message : 'Failed to move endpoint.');
      }
    },
  });

  // G12 room editor — drag-corners-to-draw + corner-drag-to-resize.
  // Active only in tool='rooms' mode + single-floor view. The hook handles
  // ESC + reset on deactivation.
  const roomEditor = useRoomEditor({
    containerRef: mapRef,
    active: editingRooms && activeFloor !== null,
    onCommit: async (rect) => {
      if (activeFloor === null) return;
      // Reject zero-area rects (the hook also rejects but defense in depth).
      if (rect.w === 0 || rect.h === 0) return;
      // Use the imperative Modal API (cycle-20 G20). The prompt() helper
      // already returns trimmed non-empty strings; null = cancel.
      const trimmed = await prompt({
        title: 'New room',
        label: 'Name',
        defaultValue: 'Room',
        placeholder: 'e.g. Kitchen',
      });
      if (trimmed === null) return; // user cancelled
      // G42(a) cycle-49 — recursive create-with-409-retry.
      const attemptCreateRoom = async (candidate: string): Promise<void> => {
        if (activeFloor === null) return;
        const tempId = `tmp-${Date.now()}`;
        const optimistic: Room = {
          id: tempId,
          floorId: activeFloor.id,
          name: candidate,
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          createdAt: Date.now(),
        };
        setRooms((prev) => [...prev, optimistic]);
        try {
          const real = await createRoom(activeFloor.id, {
            name: candidate,
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
          });
          setRooms((prev) => prev.map((r) => (r.id === tempId ? real : r)));
        } catch (err) {
          setRooms((prev) => prev.filter((r) => r.id !== tempId));
          if (err instanceof ApiHttpError && err.status === 409) {
            const suggested = suffixDuplicate(candidate);
            toast.error(`Name "${candidate}" is taken — try "${suggested}"?`);
            const retry = await prompt({
              title: 'Pick a different name',
              label: 'Name',
              defaultValue: suggested,
            });
            if (retry === null) return;
            await attemptCreateRoom(retry);
            return;
          }
          toast.error(err instanceof Error ? err.message : 'Failed to add room.');
        }
      };
      await attemptCreateRoom(trimmed);
    },
    onCornerCommit: async (roomId, corner, point) => {
      const before = rooms.find((r) => r.id === roomId);
      if (!before) return;
      // Compute the new rectangle by moving the matching corner.
      let newX = before.x;
      let newY = before.y;
      let newRight = before.x + before.w;
      let newBottom = before.y + before.h;
      switch (corner) {
        case 'tl':
          newX = point.x;
          newY = point.y;
          break;
        case 'tr':
          newRight = point.x;
          newY = point.y;
          break;
        case 'bl':
          newX = point.x;
          newBottom = point.y;
          break;
        case 'br':
          newRight = point.x;
          newBottom = point.y;
          break;
      }
      // Normalize: if right < left or bottom < top, swap.
      const x = Math.min(newX, newRight);
      const y = Math.min(newY, newBottom);
      const w = Math.abs(newRight - newX);
      const h = Math.abs(newBottom - newY);
      // Reject degenerate (zero-area) results.
      if (w < 1 || h < 1) return;
      const patched: Room = { ...before, x, y, w, h };
      setRooms((prev) => prev.map((r) => (r.id === roomId ? patched : r)));
      try {
        await updateRoom(roomId, { x, y, w, h });
      } catch (err) {
        setRooms((prev) => prev.map((r) => (r.id === roomId ? before : r)));
        toast.error(err instanceof Error ? err.message : 'Failed to move corner.');
      }
    },
  });

  const handleDeleteRoom = useCallback(async (): Promise<void> => {
    if (selectedRoomId === null) return;
    const id = selectedRoomId;
    const before = rooms.find((r) => r.id === id);
    if (!before) return;
    const ok = await confirm({
      title: 'Delete room?',
      message: `"${before.name}" will be removed from this floor.`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    setSelectedRoomId(null);
    setRooms((prev) => prev.filter((r) => r.id !== id));
    try {
      await deleteRoom(id);
    } catch (err) {
      setRooms((prev) => [...prev, before]);
      toast.error(err instanceof Error ? err.message : 'Failed to delete room.');
    }
  }, [rooms, selectedRoomId, confirm]);

  const handleDeleteWall = useCallback(async (): Promise<void> => {
    if (selectedWallId === null) return;
    const id = selectedWallId;
    const before = walls.find((w) => w.id === id);
    if (!before) return;
    const ok = await confirm({
      title: 'Delete wall?',
      message: 'The wall will be removed from this floor.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    setSelectedWallId(null);
    setWalls((prev) => prev.filter((w) => w.id !== id));
    try {
      await deleteWall(id);
    } catch (err) {
      setWalls((prev) => [...prev, before]);
      toast.error(err instanceof Error ? err.message : 'Failed to delete wall.');
    }
  }, [selectedWallId, walls, confirm]);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Cycle-70b: the cycle-53b auto-create-floor-on-upload path was REVERTED.
    // There is now ONE canonical floor-creation flow — the "Add floor" modal
    // on /map (MapLandingScreen). PanelMapScreen's Upload button only attaches
    // a plan to an EXISTING floor. When no floor exists, the button is
    // disabled + the EmptyState's "Create a floor" CTA routes the user to
    // /map. Reasoning: two creation surfaces (one explicit + named, one
    // implicit auto-named) confused users and bypassed the cycle-49 G42(a)
    // UNIQUE name flow.
    if (activeFloor === null) {
      toast.error('Create a floor on the Map tab first, then come back to upload a plan.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setUploading(true);
    try {
      await uploadFloorPlan(activeFloor.id, file);
      toast.success('Floor plan uploaded');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload floor plan.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemovePlan = async (): Promise<void> => {
    if (activeFloor === null) return;
    const ok = await confirm({
      title: 'Remove floor plan?',
      message: `The plan image for "${activeFloor.name}" will be removed. Walls, rooms, and component positions are preserved.`,
      confirmLabel: 'Remove plan',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    setUploading(true);
    try {
      await deleteFloorPlan(activeFloor.id);
      toast.success('Floor plan removed');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove floor plan.');
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveFromMap = async (componentId: string): Promise<void> => {
    const ok = await confirm({
      title: 'Remove from map?',
      message:
        'The component will be unplaced (but not deleted). You can drop it back on the map anytime.',
      confirmLabel: 'Remove',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    setSelectedComponentId(null);
    setComponents((prev) =>
      prev.map((c) => (c.id === componentId ? { ...c, posX: null, posY: null } : c))
    );
    const result = await optimistic.patch(componentId, { posX: null, posY: null });
    if (result === null) {
      await refresh();
    }
  };

  /** G23-inverse cycle-31 — slot click in the panel viz pulses all pins
   *  on the current floor controlled by that breaker. Separate from
   *  selectedComponentId so the two highlights are independent state. */
  const [selectedBreakerId, setSelectedBreakerId] = useState<string | null>(null);

  const selected = useMemo(
    () => placed.find((c) => c.id === selectedComponentId) ?? null,
    [placed, selectedComponentId]
  );

  /** G23-inverse — pins on the active floor controlled by the selected breaker. */
  const selectedBreaker = useMemo(
    () => (selectedBreakerId === null ? null : breakers.find((b) => b.id === selectedBreakerId) ?? null),
    [breakers, selectedBreakerId]
  );
  const pinsForSelectedBreaker = useMemo(
    () =>
      selectedBreakerId === null
        ? []
        : placed.filter((c) => c.breakerId === selectedBreakerId),
    [placed, selectedBreakerId]
  );

  // G25 cycle-30 — when the user clicks a pin on the floor map, pulse the
  // controlling breaker's slot in the panel-viz section below. Uses the
  // same `data-highlight="true"` + `he-slot-pulse` keyframe pinned in
  // CLAUDE.md "G23 click-to-highlight (cycle-22)" — applied to the same
  // slot-cell-<id> id that PanelVisualization renders.
  useEffect(() => {
    const breakerId = selected?.breaker?.id;
    if (!breakerId) return;
    const el = document.getElementById(`slot-cell-${breakerId}`);
    if (el === null) return;
    el.setAttribute('data-highlight', 'true');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const t = window.setTimeout(() => el.removeAttribute('data-highlight'), 1500);
    return () => window.clearTimeout(t);
  }, [selected?.breaker?.id]);

  // G23-inverse cycle-31 — when the user clicks a slot in the panel viz,
  // pulse every pin on the current floor controlled by that breaker.
  // Reuses the cycle-7 `data-highlight=true` + `he-pulse` keyframe
  // (already wired to .floor-plan__pin in styles.css).
  useEffect(() => {
    if (selectedBreakerId === null || pinsForSelectedBreaker.length === 0) return;
    const pinEls = pinsForSelectedBreaker
      .map((c) => document.getElementById(`pin-${c.id}`))
      .filter((el): el is HTMLElement => el !== null);
    if (pinEls.length === 0) return;
    for (const el of pinEls) el.setAttribute('data-highlight', 'true');
    // Scroll the first pin into view if it isn't already.
    pinEls[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = window.setTimeout(() => {
      for (const el of pinEls) el.removeAttribute('data-highlight');
    }, 1500);
    return () => window.clearTimeout(t);
  }, [selectedBreakerId, pinsForSelectedBreaker]);

  const draggingComponent =
    drag !== null ? components.find((c) => c.id === drag.id) ?? null : null;

  const planAspectStyle: CSSProperties | undefined = activeFloor?.floorPlan
    ? {
        aspectRatio: `${activeFloor.floorPlan.width} / ${activeFloor.floorPlan.height}`,
      }
    : undefined;

  return (
    <div className="map-screen">
      <div className="map-screen__body">
        <ScreenHeader
          title={panel ? `Map: ${panel.name}` : 'Map'}
          subtitle={
            activeFloor !== null
              ? `Floor: ${activeFloor.name}`
              : 'Upload a floor plan or create a floor to start placing components.'
          }
          back={`/panels/${panelId}`}
        />

        {/* Segmented control: only renders when ≥2 qualifying floors so we
           don't waste vertical real estate in the single-floor common case. */}
        {qualifyingFloors.length >= 2 && (
          <nav className="floor-switcher" aria-label="Floor switcher">
            <ul className="floor-switcher__list">
              {qualifyingFloors.map((f) => (
                <li key={f.id}>
                  <Button
                    variant={selection === f.id ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setSelection(f.id)}
                  >
                    {f.name}
                  </Button>
                </li>
              ))}
              <li>
                <Button
                  variant={selection === ALL_FLOORS ? 'primary' : 'secondary'}
                  size="sm"
                  leadingIcon={<Layers size={16} strokeWidth={2.25} />}
                  onClick={() => setSelection(ALL_FLOORS)}
                >
                  All floors
                </Button>
              </li>
            </ul>
          </nav>
        )}

        <Card className="panel-map__upload-card">
          <CardTitle className="visually-hidden">Floor plan upload</CardTitle>
          <div className="form-row">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                void handleFileChange(e);
              }}
              disabled={uploading}
              className="visually-hidden"
              id="floor-plan-input"
            />
            <Button
              type="button"
              variant="primary"
              leadingIcon={<Upload size={18} strokeWidth={2.25} />}
              // Cycle-70b: disable when no floor exists. Creation lives on
              // /map (single canonical surface). The EmptyState below has
              // a "Create a floor" CTA that navigates there.
              disabled={uploading || activeFloor === null}
              onClick={() => fileInputRef.current?.click()}
              title={
                activeFloor === null
                  ? 'Create a floor on the Map tab first'
                  : undefined
              }
            >
              {activeFloor?.floorPlan
                ? 'Replace floor plan…'
                : 'Upload floor plan…'}
            </Button>
            {activeFloor?.floorPlan && (
              <Button
                type="button"
                variant="danger"
                leadingIcon={<Trash2 size={18} strokeWidth={2.25} />}
                disabled={uploading}
                onClick={() => {
                  void handleRemovePlan();
                }}
              >
                Remove plan
              </Button>
            )}
          </div>
        </Card>

        <section className="section" aria-labelledby="map-heading">
          <h2 id="map-heading" className="section-title">
            Floor plan
          </h2>
          {loading ? (
            <Skeleton variant="card" aria-label="Loading floor plan" />
          ) : activeFloor === null ? (
            <EmptyState
              illustration={<NoFloors />}
              title="No floor for this panel yet"
              description="Components on this panel's breakers aren't on any floor yet. Place one from the map below, or create a floor from the Map tab landing."
              action={
                <Link href="/map">
                  <Button>Create a floor</Button>
                </Link>
              }
            />
          ) : (
            <>
              {/* G12 toolbar — 3-way tool: pin (default) / walls / rooms. */}
              <div className="map-toolbar">
                {tool === 'pin' && (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      leadingIcon={<Pencil size={16} strokeWidth={2.25} />}
                      onClick={() => setTool('walls')}
                    >
                      Edit walls
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      leadingIcon={<Pencil size={16} strokeWidth={2.25} />}
                      onClick={() => setTool('rooms')}
                    >
                      Edit rooms
                    </Button>
                  </>
                )}
                {tool === 'walls' && (
                  <>
                    <span className="muted">
                      {selectedWallId !== null
                        ? 'Wall selected — drag endpoints or delete'
                        : wallEditor.firstEndpoint !== null
                          ? 'Tap to set the second endpoint'
                          : 'Tap an empty spot to start a wall, or tap a wall to select it'}
                    </span>
                    {selectedWallId !== null && (
                      <Button
                        variant="danger"
                        size="sm"
                        leadingIcon={<Trash2 size={16} strokeWidth={2.25} />}
                        onClick={() => {
                          void handleDeleteWall();
                        }}
                      >
                        Delete wall
                      </Button>
                    )}
                    <IconButton
                      icon={<X size={18} strokeWidth={2.25} />}
                      aria-label="Exit wall edit mode"
                      variant="default"
                      onClick={() => {
                        setTool('pin');
                        setSelectedWallId(null);
                      }}
                    />
                  </>
                )}
                {tool === 'rooms' && (
                  <>
                    <span className="muted">
                      {selectedRoomId !== null
                        ? 'Room selected — drag corners to resize, or delete'
                        : 'Press and drag to draw a room — release for the name prompt'}
                    </span>
                    {selectedRoomId !== null && (
                      <Button
                        variant="danger"
                        size="sm"
                        leadingIcon={<Trash2 size={16} strokeWidth={2.25} />}
                        onClick={() => {
                          void handleDeleteRoom();
                        }}
                      >
                        Delete room
                      </Button>
                    )}
                    <IconButton
                      icon={<X size={18} strokeWidth={2.25} />}
                      aria-label="Exit room edit mode"
                      variant="default"
                      onClick={() => {
                        setTool('pin');
                        setSelectedRoomId(null);
                      }}
                    />
                  </>
                )}
              </div>

              <div
                ref={mapRef}
                className={
                  'floor-plan' +
                  (activeFloor.floorPlan === null ? ' floor-plan--vector-only' : '')
                }
                style={
                  activeFloor.floorPlan !== null ? planAspectStyle : undefined
                }
              >
                {activeFloor.floorPlan !== null && (
                  <img
                    src={floorPlanUrl(activeFloor.floorPlan.filename)}
                    alt={`${activeFloor.name} floor plan`}
                    className="floor-plan__img"
                    draggable={false}
                  />
                )}
                {/* Vector SVG overlay — walls + rooms. Both render read-only
                   when not in their respective edit mode. */}
                <FloorPlanVectorOverlay
                  walls={walls}
                  rooms={rooms}
                  selectedWallId={editingWalls ? selectedWallId : null}
                  selectedRoomId={editingRooms ? selectedRoomId : null}
                  ghostWall={
                    editingWalls && wallEditor.firstEndpoint && wallEditor.ghostEndpoint
                      ? {
                          x1: wallEditor.firstEndpoint.x,
                          y1: wallEditor.firstEndpoint.y,
                          x2: wallEditor.ghostEndpoint.x,
                          y2: wallEditor.ghostEndpoint.y,
                        }
                      : null
                  }
                  ghostRoom={
                    editingRooms && roomEditor.drawing
                      ? rectFromCorners(
                          roomEditor.drawing.anchor,
                          roomEditor.drawing.current
                        )
                      : null
                  }
                />
                {/* Interactive edit layer */}
                {editingWalls && (
                  <svg
                    className="floor-plan__vector floor-plan__vector--interactive floor-plan__edit-capture"
                    viewBox="0 0 10000 10000"
                    preserveAspectRatio="none"
                    {...wallEditor.handlers}
                  >
                    {/* Transparent hit-rect catches background taps for the draw tool. */}
                    <rect
                      x="0"
                      y="0"
                      width="10000"
                      height="10000"
                      fill="transparent"
                      onClick={(e) => {
                        // Tap on background while a wall is selected → deselect.
                        if (selectedWallId !== null) {
                          e.stopPropagation();
                          setSelectedWallId(null);
                        }
                      }}
                    />
                    {/* Selectable wall hit-targets (thick, transparent overlays
                       for easier tapping). When tapped, select the wall. */}
                    {walls.map((w) => (
                      <line
                        key={`hit-${w.id}`}
                        x1={w.x1}
                        y1={w.y1}
                        x2={w.x2}
                        y2={w.y2}
                        className="floor-plan__wall-hit"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelectedWallId(w.id);
                        }}
                      />
                    ))}
                    {/* First-endpoint marker during draw. */}
                    {wallEditor.firstEndpoint && (
                      <circle
                        cx={wallEditor.firstEndpoint.x}
                        cy={wallEditor.firstEndpoint.y}
                        r={90}
                        className="floor-plan__wall-handle"
                      />
                    )}
                    {/* Endpoint handles for the selected wall. */}
                    {selectedWallId !== null &&
                      (() => {
                        const sel = walls.find((w) => w.id === selectedWallId);
                        if (!sel) return null;
                        // While dragging, render the handle at the snapped current point
                        const drag = wallEditor.endpointDrag;
                        const e1: Point =
                          drag && drag.wallId === sel.id && drag.endpoint === 1
                            ? drag.current
                            : { x: sel.x1, y: sel.y1 };
                        const e2: Point =
                          drag && drag.wallId === sel.id && drag.endpoint === 2
                            ? drag.current
                            : { x: sel.x2, y: sel.y2 };
                        return (
                          <>
                            <circle
                              cx={e1.x}
                              cy={e1.y}
                              r={180}
                              className="floor-plan__wall-handle"
                              onPointerDown={(e) =>
                                wallEditor.startEndpointDrag(sel.id, 1, e)
                              }
                            />
                            <circle
                              cx={e2.x}
                              cy={e2.y}
                              r={180}
                              className="floor-plan__wall-handle"
                              onPointerDown={(e) =>
                                wallEditor.startEndpointDrag(sel.id, 2, e)
                              }
                            />
                          </>
                        );
                      })()}
                  </svg>
                )}
                {/* G12 rooms interactive edit layer */}
                {editingRooms && (
                  <svg
                    className="floor-plan__vector floor-plan__vector--interactive floor-plan__edit-capture"
                    viewBox="0 0 10000 10000"
                    preserveAspectRatio="none"
                    {...roomEditor.handlers}
                  >
                    {/* Background hit-rect — taps deselect; drags start a draw. */}
                    <rect
                      x="0"
                      y="0"
                      width="10000"
                      height="10000"
                      fill="transparent"
                      onClick={(e) => {
                        if (selectedRoomId !== null) {
                          e.stopPropagation();
                          setSelectedRoomId(null);
                        }
                      }}
                    />
                    {/* Per-room hit-rect (transparent, slightly larger fill area
                       for finger taps). pointerdown selects the room. */}
                    {rooms.map((r) => (
                      <rect
                        key={`rhit-${r.id}`}
                        x={r.x}
                        y={r.y}
                        width={r.w}
                        height={r.h}
                        className="floor-plan__room-hit"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelectedRoomId(r.id);
                        }}
                      />
                    ))}
                    {/* Corner handles for the selected room. While a corner
                       drag is in flight, render the handle at the snapped
                       current point so the user sees what they're committing. */}
                    {selectedRoomId !== null &&
                      (() => {
                        const sel = rooms.find((r) => r.id === selectedRoomId);
                        if (!sel) return null;
                        const drag = roomEditor.cornerDrag;
                        // Per-corner positions, overridden by drag.current if active.
                        const corners: { corner: Corner; x: number; y: number }[] = [
                          { corner: 'tl', x: sel.x, y: sel.y },
                          { corner: 'tr', x: sel.x + sel.w, y: sel.y },
                          { corner: 'bl', x: sel.x, y: sel.y + sel.h },
                          { corner: 'br', x: sel.x + sel.w, y: sel.y + sel.h },
                        ];
                        return (
                          <>
                            {corners.map((c) => {
                              const pt =
                                drag && drag.roomId === sel.id && drag.corner === c.corner
                                  ? drag.current
                                  : { x: c.x, y: c.y };
                              return (
                                <circle
                                  key={c.corner}
                                  cx={pt.x}
                                  cy={pt.y}
                                  r={180}
                                  className="floor-plan__corner-handle"
                                  onPointerDown={(e) =>
                                    roomEditor.startCornerDrag(sel.id, c.corner, e)
                                  }
                                />
                              );
                            })}
                          </>
                        );
                      })()}
                  </svg>
                )}
                {!editingWalls && !editingRooms &&
                  placed.map((c) => {
                    const pinStyle: CSSProperties = {
                      left: `${((c.posX ?? 0) / 10000) * 100}%`,
                      top: `${((c.posY ?? 0) / 10000) * 100}%`,
                    };
                    return (
                      <button
                        key={c.id}
                        type="button"
                        id={`pin-${c.id}`}
                        className={
                          'floor-plan__pin' +
                          (selectedComponentId === c.id ? ' floor-plan__pin--selected' : '') +
                          (drag?.id === c.id ? ' floor-plan__pin--dragging' : '')
                        }
                        style={pinStyle}
                        onClick={() => setSelectedComponentId(c.id)}
                        aria-label={`${c.name} — ${componentTypeLabel(c.type)}`}
                        {...handlersFor(c.id)}
                      >
                        <ComponentTypeIcon type={c.type} size={14} />
                      </button>
                    );
                  })}
              </div>
              {activeFloor.floorPlan === null && walls.length === 0 && !editingWalls && (
                <p className="muted map-hint">
                  No floor plan image yet. You can still draw walls — tap{' '}
                  <strong>Edit walls</strong> above.
                </p>
              )}
            </>
          )}
        </section>

        {/* G25 cycle-30 — Panel viz on the map screen. User clicks a pin on
           the floor map → the controlling breaker's slot pulses in the panel
           viz below. Same pattern as cycle-22 G23 hash-consumer + cycle-24
           Components-on-panel side-by-side, but driven by selectedComponentId
           state instead of URL hash (we're on the map route, not panel detail). */}
        {panel !== null && breakers.length > 0 && (
          <section className="section panel-map__panel-viz" aria-labelledby="map-panel-viz-heading">
            <div className="panel-map__panel-viz-header">
              <h2 id="map-panel-viz-heading" className="section-title">
                Panel
              </h2>
              {selectedBreaker !== null ? (
                <span className="panel-map__panel-viz-hint">
                  Slot {selectedBreaker.slot}: {selectedBreaker.label} ·{' '}
                  {pinsForSelectedBreaker.length === 0
                    ? 'no pins on this floor'
                    : `${pinsForSelectedBreaker.length} pin${pinsForSelectedBreaker.length === 1 ? '' : 's'} pulsing above`}
                </span>
              ) : selected !== null && selected.breaker !== null ? (
                <span className="panel-map__panel-viz-hint">
                  Highlighting slot {selected.breaker.slot}: {selected.breaker.label}
                </span>
              ) : (
                <span className="panel-map__panel-viz-hint muted">
                  Tap a pin above to see its breaker — or tap a slot below to highlight its pins
                </span>
              )}
            </div>
            <PanelVisualization
              panel={panel}
              breakers={breakers}
              onSlotClick={(_n, breaker) => {
                /* G23-inverse cycle-31 — slot click highlights pins on
                   this floor controlled by that breaker. Empty slots are
                   no-op (breaker is null). */
                if (breaker !== null) {
                  setSelectedBreakerId(breaker.id);
                  // Clear any previous pin-click selection so the two
                  // highlights don't compete; user just did a fresh slot click.
                  setSelectedComponentId(null);
                }
              }}
            />
          </section>
        )}

        {activeFloor !== null && (
          <section className="section" aria-labelledby="unplaced-heading">
            <h2 id="unplaced-heading" className="section-title">
              Unplaced ({unplaced.length})
            </h2>
            {unplaced.length === 0 ? (
              <p className="muted">
                Every component on this panel's breakers is placed on the selected floor.
              </p>
            ) : (
              <ul className="unplaced-list">
                {unplaced.map((c) => (
                  <li
                    key={c.id}
                    className={
                      ms.isSelected(c.id)
                        ? 'unplaced-item unplaced-item--selected'
                        : 'unplaced-item'
                    }
                    data-testid="unplaced-item"
                    data-component-id={c.id}
                    data-selected={ms.isSelected(c.id) ? 'true' : 'false'}
                  >
                    {/* G42(f) cycle-51 — Checkbox is a SIBLING of the Button
                        (NOT a child) so the drag's setPointerCapture on
                        pointerdown can't swallow the checkbox click. The
                        Checkbox's label has its own 44px hit area. */}
                    <span className="unplaced-item__select">
                      <Checkbox
                        checked={ms.isSelected(c.id)}
                        onChange={() => ms.toggle(c.id)}
                        ariaLabel={`Select ${c.name}`}
                        testId="unplaced-item-checkbox"
                      />
                    </span>
                    <Button
                      variant="ghost"
                      block
                      className="unplaced-item__btn"
                      aria-label={`Drag ${c.name} onto the map`}
                      {...handlersFor(c.id)}
                    >
                      <span className="component-row__icon" aria-hidden="true">
                        <ComponentTypeIcon type={c.type} />
                      </span>
                      <span className="component-row__main">
                        <span className="component-row__name">{c.name}</span>
                        <span className="component-row__meta">
                          <span>{componentTypeLabel(c.type)}</span>
                          {c.room && <span>· {c.room}</span>}
                          {c.breaker && (
                            <span className="muted">
                              {' '}· slot {c.breaker.slot}{c.breaker.tandemHalf ?? ''}
                            </span>
                          )}
                        </span>
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {selected && (
          <section className="section" aria-labelledby="selected-heading">
            <h2 id="selected-heading" className="section-title">
              Selected component
            </h2>
            <Card>
              <div className="component-row">
                <span className="component-row__icon" aria-hidden="true">
                  <ComponentTypeIcon type={selected.type} />
                </span>
                <div className="component-row__main">
                  <div className="component-row__name-row">
                    <span className="component-row__name">{selected.name}</span>
                  </div>
                  <div className="component-row__meta">
                    <span>{componentTypeLabel(selected.type)}</span>
                    {selected.room && <span>· {selected.room}</span>}
                  </div>
                  {selected.breaker ? (
                    <Link
                      href={`/panels/${selected.breaker.panelId}#breaker-${selected.breaker.id}`}
                      className="component-row__callout"
                    >
                      <Zap size={16} strokeWidth={2.25} aria-hidden="true" />
                      <span>
                        slot {selected.breaker.slot} · {selected.breaker.label} ·{' '}
                        {selected.breaker.amperage}A
                        <span className="muted"> · on {selected.breaker.panelName}</span>
                      </span>
                    </Link>
                  ) : (
                    <span className="component-row__callout component-row__callout--unwired">
                      Not wired
                    </span>
                  )}
                  <div className="row-actions">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        void handleRemoveFromMap(selected.id);
                      }}
                    >
                      Remove from map
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </section>
        )}
      </div>

      {drag && draggingComponent && (
        <div
          className="map-ghost"
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: drag.ghostX,
            top: drag.ghostY,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            zIndex: 1000,
          }}
        >
          <span className="floor-plan__pin floor-plan__pin--ghost">
            <ComponentTypeIcon type={draggingComponent.type} size={20} />
          </span>
        </div>
      )}
      {modalNode}
      {/* G42(f) cycle-51 — portal-mounted SelectionBar at document.body so the
          `body:has(.selection-bar) .bottom-tabs { display: none }` CSS rule
          matches (cycle-50 contract). Only mounts while >=1 unplaced row is
          selected. */}
      {ms.count > 0 &&
        createPortal(
          <SelectionBar
            count={ms.count}
            onClear={ms.clear}
            actions={selectionActions}
          />,
          document.body
        )}
    </div>
  );
};
