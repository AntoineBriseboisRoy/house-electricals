import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CornerDownRight,
  GitFork,
  Lightbulb,
  MousePointer2,
  Pencil,
  Power,
  Square,
  ToggleRight,
  Trash2,
  X as XIcon,
  Zap,
  ZoomIn,
} from 'lucide-react';
import {
  componentInputSchema,
  type ComponentInput,
  type ComponentType,
  type Floor,
  type Panel,
  type ResolvedComponent,
  type ResolvedSwitchControl,
  type Room,
  type SwitchControl,
  type Wall,
} from '@he/shared';
import {
  addSwitchControl,
  ApiHttpError,
  createComponent,
  createRoom,
  createWall,
  deleteComponent,
  deleteFloor,
  deleteRoom,
  deleteWall,
  floorPlanUrl,
  getFloor,
  listAllBreakersGrouped,
  listAllRooms,
  listComponents,
  listPanels,
  listRooms,
  listSwitchControls,
  listSwitchControlsByFloor,
  listWalls,
  removeSwitchControl,
  updateComponent,
  updateFloor,
  updateRoom,
  updateWall,
  type PanelWithBreakers,
} from '../api.js';
import { BreakerPicker } from '../components/BreakerPicker.js';
import { ComponentForm } from '../components/ComponentForm.js';
import { suffixDuplicate } from '../lib/duplicateName.js';
import {
  Button,
  Card,
  CardActions,
  CardHeader,
  CardTitle,
  EmptyState,
  FloorPlanVectorOverlay,
  IconButton,
  Input,
  Modal,
  PanelVisualization,
  ScreenHeader,
  Select,
  Skeleton,
  toast,
  Tooltip,
} from '../ui/index.js';
import { ProtectionBadge } from '../components/ProtectionBadge.js';
import { useViewport, type Point } from '../hooks/useViewport.js';
import { useWallEditor } from '../hooks/useWallEditor.js';
import {
  rectFromCorners,
  useRoomEditor,
  type Corner,
} from '../hooks/useRoomEditor.js';
import { useModal } from '../hooks/useModal.js';
import { useUndoableDelete } from '../hooks/useUndoableDelete.js';
import { findRoomForPoint, findPointsInRect } from '../lib/roomLookup.js';

/**
 * Desktop-class map builder for one floor (G15).
 *
 * Three-column layout on desktop (>= 960px):
 *   .floor-edit__tools (240px)  |  .floor-edit__canvas (1fr)  |  .floor-edit__props (280px)
 *
 * On phone (single column): tools collapse to a horizontal palette above
 * the canvas; the properties panel shows only when something is selected.
 *
 * The canvas hosts the existing FloorPlanVectorOverlay (read-only render of
 * walls+rooms) with a `transform` attribute supplied by `useViewport` so the
 * user can pan/zoom. useWallEditor + useRoomEditor are wired into the same
 * canvas — each becomes active based on the `tool` state.
 *
 * Keyboard shortcuts (only when no INPUT/TEXTAREA is focused):
 *   V = pointer  ·  W = wall  ·  R = room
 *   ESC = deselect + cancel in-flight gesture
 *   Delete / Backspace = remove selected
 *   0 = reset viewport
 *
 * See CLAUDE.md "Desktop map builder (G15)" for the pinned contract.
 */

type Tool =
  | 'pointer'
  | 'wall'
  | 'room'
  /** G19 quick-create tools: tap on canvas → POST /components at the snapped point. */
  | 'outlet'
  | 'light'
  | 'switch';

const QUICK_CREATE_TOOLS: ReadonlySet<Tool> = new Set(['outlet', 'light', 'switch']);

export const FloorEditScreen = (): JSX.Element => {
  const [, params] = useRoute<{ id: string }>('/floors/:id/edit');
  const floorId = params?.id ?? '';
  const [, setLocation] = useLocation();

  const [floor, setFloor] = useState<Floor | null>(null);
  const [walls, setWalls] = useState<Wall[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [componentsOnFloor, setComponentsOnFloor] = useState<ResolvedComponent[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  /** Cycle-86 — house-level breaker groups for the Edit-details Modal's
   *  ComponentForm Wiring section. Mirrors ComponentsScreen state shape;
   *  loaded alongside floor data in refresh(). */
  const [breakerGroups, setBreakerGroups] = useState<PanelWithBreakers[]>([]);
  /** Cycle-86 — house-level rooms feed for the ComponentForm Room datalist
   *  suggestions. Same shape ComponentsScreen consumes. */
  const [allRooms, setAllRooms] = useState<Room[]>([]);
  /** Cycle-86 — selected component id whose edit-details Modal is open.
   *  Null = Modal closed. The component itself is resolved via
   *  componentsOnFloor lookup inside the Modal mount. */
  const [editingComponentId, setEditingComponentId] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const [tool, setTool] = useState<Tool>('pointer');
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [switchControls, setSwitchControls] = useState<ResolvedSwitchControl[]>([]);
  /** G38 cycle-64 — flat list of every switch-control row whose switch OR
   *  controlled component lives on this floor. Powers (a) the "3-way"
   *  badge on gang handles, (b) the inverse render branch when a
   *  co-controlled light is selected, (c) the "Controlled by" sidebar
   *  list. Fetched in refresh() in parallel with the rest. */
  const [floorSwitchControls, setFloorSwitchControls] = useState<SwitchControl[]>([]);
  /** G20 in-flight gang-to-light drag. While non-null, a thin dotted SVG
   *  line follows the pointer from the gang's origin (viewbox) to the
   *  current pointer (viewbox). On pointerup, elementFromPoint resolves the
   *  drop target via `data-link-target` + `data-pin-id` on the pin button.
   *  See CLAUDE.md "Modal primitive (G20)" / "drag-to-link" pinned rules. */
  const [linkDrag, setLinkDrag] = useState<{
    switchId: string;
    gangIndex: number;
    origin: Point;
    current: Point;
    /** Currently-hovered pin id (for visual highlight + early invalid
     *  feedback). null when not over a valid link target. */
    hoverPinId: string | null;
  } | null>(null);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  /** Track unmount so post-async setState doesn't fire on a disposed tree.
   *  Important: under React StrictMode (Vite dev default), effects run
   *  setup → cleanup → setup. The cleanup sets aliveRef.current = false;
   *  the SECOND setup MUST re-set it to true or every guard short-circuits
   *  forever (the cycle-15 "skeleton forever" regression). */
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const viewport = useViewport();
  const { confirm, prompt, pick, modalNode } = useModal();
  const { deleteWithUndo } = useUndoableDelete();

  const refresh = useCallback(async (): Promise<void> => {
    if (!floorId) return;
    setLoading(true);
    try {
      const [f, w, r, comps, ps, scs, groups, rms] = await Promise.all([
        getFloor(floorId),
        listWalls(floorId),
        listRooms(floorId),
        listComponents({ floorId }),
        listPanels(),
        // G38 cycle-64 — flat per-floor switch-controls feed.
        listSwitchControlsByFloor(floorId),
        // Cycle-86 — house-level breakers grouped by panel for the
        // edit-details Modal's ComponentForm Wiring section.
        listAllBreakersGrouped(),
        // Cycle-86 — house-level rooms for the ComponentForm Room
        // datalist autocomplete (matches ComponentsScreen pattern).
        listAllRooms(),
      ]);
      if (!aliveRef.current) return;
      setFloor(f);
      setWalls(w);
      setRooms(r);
      setComponentsOnFloor(comps);
      setPanels(ps);
      setFloorSwitchControls(scs);
      setBreakerGroups(groups);
      setAllRooms(rms);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load floor.');
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [floorId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Refactor 2026-05 — hash deep-link consumer.
   *
   * Mirrors PanelMapScreen's `#pin-<componentId>` consumer so the Library
   * tab's "View on map" row link can deep-link straight into the floor
   * canvas. Selects the matching component (drawer shows its breaker
   * context) and pulses the pin via the cycle-13 G13 data-highlight rule. */
  useEffect(() => {
    if (loading) return;
    if (componentsOnFloor.length === 0) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#pin-')) return;
    const id = hash.slice('#pin-'.length);
    const exists = componentsOnFloor.some((c) => c.id === id);
    if (!exists) return;
    setSelectedComponentId(id);
    const el = document.getElementById(`pin-${id}`);
    if (el === null) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.setAttribute('data-highlight', 'true');
    const t = window.setTimeout(
      () => el.removeAttribute('data-highlight'),
      1500
    );
    return () => window.clearTimeout(t);
  }, [loading, componentsOnFloor]);

  /** Refactor 2026-05 iter-5 — scroll the highlighted slot in the
   *  breaker-context mini-viz into view whenever the selected component
   *  changes. The mini-viz caps at 280px tall and the active slot may be
   *  outside the initial scroll position (e.g. slot 18 of 24). Without
   *  this, the user has to manually scroll to find the ringed slot. */
  useEffect(() => {
    if (selectedComponentId === null) return;
    const sel = componentsOnFloor.find((c) => c.id === selectedComponentId);
    if (sel === undefined || sel.breaker === null) return;
    const raf = window.requestAnimationFrame(() => {
      const slotEl = document.querySelector(
        `[data-testid="component-breaker-context-mini"] [data-breaker-id="${sel.breaker!.id}"]`
      );
      if (slotEl !== null) {
        slotEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [selectedComponentId, componentsOnFloor]);

  /** Tools switch → drop selections that don't make sense in the next
   *  mode. G32 cycle-40: pointer is the universal manipulation tool, so
   *  wall/room/component selections all persist in pointer mode. Only
   *  when the user switches to a quick-create tool (outlet/light/switch)
   *  or to a different draw tool (wall/room) do we clear the other
   *  modalities. */
  useEffect(() => {
    if (tool !== 'wall' && tool !== 'pointer') setSelectedWallId(null);
    if (tool !== 'room' && tool !== 'pointer') setSelectedRoomId(null);
    if (tool !== 'pointer') setSelectedComponentId(null);
  }, [tool]);

  /** When a switch is selected (or selection cleared), refresh its
   *  control links so the properties sidebar renders the right list. */
  useEffect(() => {
    if (selectedComponentId === null) {
      setSwitchControls([]);
      return;
    }
    const sel = componentsOnFloor.find((c) => c.id === selectedComponentId);
    if (sel === undefined || sel.type !== 'switch') {
      setSwitchControls([]);
      return;
    }
    void listSwitchControls(sel.id)
      .then(setSwitchControls)
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : 'Failed to load controls.');
      });
  }, [componentsOnFloor, selectedComponentId]);

  // === G38 cycle-64 — co-controlled / three-way memos =====================
  //
  // Detection rule: keyed on `controlled_id` set. A light/outlet has the
  // "3-way" treatment when >= 2 DISTINCT switches contribute control rows
  // for it. A switch's gang inherits the badge when ANY light it controls
  // is co-controlled. See CLAUDE.md "Three-way / co-controlled switches".

  /** Map controlled-component id → all SwitchControl rows pointing at it. */
  const controlsByControlledId = useMemo((): Map<string, SwitchControl[]> => {
    const m = new Map<string, SwitchControl[]>();
    for (const sc of floorSwitchControls) {
      const existing = m.get(sc.controlledId);
      if (existing === undefined) {
        m.set(sc.controlledId, [sc]);
      } else {
        existing.push(sc);
      }
    }
    return m;
  }, [floorSwitchControls]);

  /** Set of controlled-component ids that are co-controlled (>=2 distinct
   *  switches contribute). */
  const coControlledIds = useMemo((): Set<string> => {
    const out = new Set<string>();
    for (const [cid, rows] of controlsByControlledId) {
      const distinctSwitches = new Set(rows.map((r) => r.switchId));
      if (distinctSwitches.size >= 2) out.add(cid);
    }
    return out;
  }, [controlsByControlledId]);

  /** Map "<switchId>::<gangIdx>" → SwitchControl[] rows for that gang.
   *  Used to determine whether a gang handle should render the 3-way
   *  badge: any controlled id from this gang that's in coControlledIds. */
  const controlsBySwitchGang = useMemo((): Map<string, SwitchControl[]> => {
    const m = new Map<string, SwitchControl[]>();
    for (const sc of floorSwitchControls) {
      const key = `${sc.switchId}::${sc.gangIndex}`;
      const existing = m.get(key);
      if (existing === undefined) {
        m.set(key, [sc]);
      } else {
        existing.push(sc);
      }
    }
    return m;
  }, [floorSwitchControls]);

  /** Cycle-86 — resolve the editing component id to the ResolvedComponent
   *  shape pulled from `componentsOnFloor`. Null when the Modal is closed
   *  or the id no longer matches (e.g. the component was deleted while
   *  the Modal was open). */
  const editingComponent = useMemo(
    () =>
      editingComponentId === null
        ? null
        : (componentsOnFloor.find((c) => c.id === editingComponentId) ?? null),
    [componentsOnFloor, editingComponentId]
  );

  /** Cycle-86 — union of (a) house-level rooms drawn on any floor map,
   *  (b) distinct room names typed on any component on THIS floor.
   *  Mirrors ComponentsScreen `roomSuggestions` shape; passed verbatim to
   *  ComponentForm for its Room datalist. */
  const roomSuggestions = useMemo((): string[] => {
    const set = new Set<string>();
    for (const r of allRooms) {
      if (r.name.trim().length > 0) set.add(r.name);
    }
    for (const c of componentsOnFloor) {
      if (c.room !== null && c.room.trim().length > 0) set.add(c.room);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allRooms, componentsOnFloor]);

  /** Auto-name lookup: count existing components of the same type on this
   *  floor and label the new one "Outlet N+1" / "Light N+1" / etc. */
  const nextNameFor = (type: ComponentType, gangs: number): string => {
    const n =
      componentsOnFloor.filter((c) => c.type === type).length + 1;
    if (type === 'switch') {
      return gangs > 1 ? `${gangs}-gang switch ${n}` : `Switch ${n}`;
    }
    if (type === 'outlet') return `Outlet ${n}`;
    if (type === 'light') return `Light ${n}`;
    return `${type} ${n}`;
  };

  /** Quick-create handler — invoked by the canvas pointerdown when a
   *  component tool is active. Snaps the click coord and POSTs a new
   *  component pre-placed at that position. */
  const handleQuickCreate = useCallback(
    async (point: { x: number; y: number }): Promise<void> => {
      if (floor === null) return;
      if (!QUICK_CREATE_TOOLS.has(tool)) return;
      const type = tool as 'outlet' | 'light' | 'switch';
      let gangs = 1;
      if (type === 'switch') {
        const picked = await pick<number>({
          title: 'How many gangs?',
          message: 'Pick the switch configuration.',
          options: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
            value: n,
            label: n === 1 ? 'Single gang' : `${n}-gang`,
          })),
        });
        if (picked === null) return; // user cancelled
        gangs = picked;
      }
      const name = nextNameFor(type, gangs);
      // G26 — auto-bind: if the drop point falls inside an existing room
      // rect, set components.room to the room's name in the SAME create
      // call. Avoids a separate PATCH round-trip and keeps the data
      // consistent from the moment the component lands.
      const containingRoom = findRoomForPoint(rooms, point.x, point.y);
      try {
        const created = await createComponent({
          type,
          name,
          floorId: floor.id,
          posX: Math.round(point.x),
          posY: Math.round(point.y),
          gangs,
          room: containingRoom?.name ?? null,
        });
        // Optimistic local insert (createComponent returns the plain Component;
        // we widen to ResolvedComponent with breaker: null since it has no
        // breaker yet).
        const placed: ResolvedComponent = { ...created, breaker: null };
        setComponentsOnFloor((prev) => [...prev, placed]);
        setSelectedComponentId(created.id);
        // Drop back to pointer so the next tap selects rather than creates.
        setTool('pointer');
        toast.success(
          containingRoom ? `Created ${name} in ${containingRoom.name}` : `Created ${name}`
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to create component.');
      }
    },
    // formApi-style stable callback — depends on tool + floor + componentsOnFloor for
    // the name counter; the inline closures are recreated each render but that's fine
    // here since the canvas pointerdown re-binds via the handler prop below.
    [floor, tool, componentsOnFloor, pick, rooms]
  );

  /** Pin click — selects the component in the properties sidebar. In
   *  pointer mode (G32 cycle-40) we also clear wall/room selection so
   *  the properties sidebar shows the component card rather than
   *  fighting with the wall/room card. */
  const handleSelectComponent = useCallback((id: string): void => {
    setSelectedComponentId(id);
    setSelectedWallId(null);
    setSelectedRoomId(null);
  }, []);

  // G42(c) cycle-47 — one-tap delete + 30s undo. The previous cycle's
  // confirm-modal-then-execute pattern is gone; the hook handles
  // optimistic removal + restore-on-undo + restore-on-server-error.
  const handleDeleteSelectedComponent = useCallback((): void => {
    if (selectedComponentId === null) return;
    const id = selectedComponentId;
    const target = componentsOnFloor.find((c) => c.id === id);
    if (!target) return;
    const prevList = componentsOnFloor;
    deleteWithUndo({
      id,
      resourceType: 'component',
      label: target.name,
      removeOptimistically: () => {
        setSelectedComponentId(null);
        setComponentsOnFloor((prev) => prev.filter((c) => c.id !== id));
      },
      restore: () => {
        setComponentsOnFloor(prevList);
      },
      commit: async () => {
        await deleteComponent(id);
      },
    });
  }, [componentsOnFloor, selectedComponentId, deleteWithUndo]);

  const handleRenameSelectedComponent = useCallback(async (): Promise<void> => {
    if (selectedComponentId === null) return;
    const before = componentsOnFloor.find((c) => c.id === selectedComponentId);
    if (!before) return;
    const next = await prompt({
      title: 'Rename component',
      label: 'Name',
      defaultValue: before.name,
      placeholder: before.name,
    });
    if (next === null) return;
    if (next === before.name) return;
    setComponentsOnFloor((prev) =>
      prev.map((c) => (c.id === before.id ? { ...c, name: next } : c))
    );
    try {
      await updateComponent(before.id, { name: next });
    } catch (err) {
      setComponentsOnFloor((prev) =>
        prev.map((c) => (c.id === before.id ? before : c))
      );
      toast.error(err instanceof Error ? err.message : 'Failed to rename.');
    }
  }, [componentsOnFloor, selectedComponentId, prompt]);

  /** Refactor 2026-05 follow-up — inline breaker picker for the selected
   *  component. PATCHes the component then refresh()es so the drawer
   *  reflects the new wiring (and, for switches, the just-shipped
   *  switch→controlled propagation propagates breakerId to every
   *  controlled component server-side; refresh shows them on the next
   *  pin tap). */
  const handleAssignBreaker = useCallback(
    async (nextBreakerId: string | null): Promise<void> => {
      if (selectedComponentId === null) return;
      const before = componentsOnFloor.find(
        (c) => c.id === selectedComponentId
      );
      if (before === undefined) return;
      if ((before.breakerId ?? null) === nextBreakerId) return;
      try {
        await updateComponent(selectedComponentId, {
          breakerId: nextBreakerId,
        });
        if (before.type === 'switch') {
          toast.success(
            nextBreakerId === null
              ? 'Switch + its controlled components unwired'
              : 'Switch + its controlled components wired'
          );
        } else {
          toast.success(
            nextBreakerId === null ? 'Component unwired' : 'Component wired'
          );
        }
        void refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to wire.');
      }
    },
    [componentsOnFloor, selectedComponentId, refresh]
  );

  const handleAddControl = useCallback(
    async (gangIndex: number): Promise<void> => {
      if (selectedComponentId === null) return;
      const sw = componentsOnFloor.find((c) => c.id === selectedComponentId);
      if (sw === undefined || sw.type !== 'switch') return;
      // Build a list of available lights+outlets the user can pick from.
      const candidates = componentsOnFloor.filter(
        (c) => c.type === 'light' || c.type === 'outlet'
      );
      const picked = await pick<string>({
        title: `Link Gang ${gangIndex + 1}`,
        message: 'Choose a light or outlet to control.',
        options: candidates.map((c) => ({
          value: c.id,
          label: c.name,
          hint: c.type,
        })),
        emptyMessage: 'No lights or outlets on this floor to link.',
      });
      if (picked === null) return;
      const target = candidates.find((c) => c.id === picked);
      if (!target) return;
      try {
        const link = await addSwitchControl(sw.id, gangIndex, target.id);
        setSwitchControls((prev) => {
          const exists = prev.some(
            (p) => p.gangIndex === gangIndex && p.controlled.id === target.id
          );
          return exists ? prev : [...prev, link];
        });
        // G38 cycle-64 — keep the floor-wide feed in sync so the
        // "3-way" badge + Controlled-by list react immediately.
        setFloorSwitchControls((prev) => {
          const exists = prev.some(
            (p) =>
              p.switchId === sw.id &&
              p.gangIndex === gangIndex &&
              p.controlledId === target.id
          );
          return exists
            ? prev
            : [
                ...prev,
                { switchId: sw.id, gangIndex, controlledId: target.id },
              ];
        });
        // Refactor 2026-05 follow-up — refresh so the controlled
        // component's just-propagated breakerId shows in the drawer.
        void refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to link.');
      }
    },
    [componentsOnFloor, selectedComponentId, pick, refresh]
  );

  const handleRemoveControl = useCallback(
    async (gangIndex: number, controlledId: string): Promise<void> => {
      if (selectedComponentId === null) return;
      const before = switchControls;
      const beforeFloor = floorSwitchControls;
      setSwitchControls((prev) =>
        prev.filter(
          (p) => !(p.gangIndex === gangIndex && p.controlled.id === controlledId)
        )
      );
      setFloorSwitchControls((prev) =>
        prev.filter(
          (p) =>
            !(
              p.switchId === selectedComponentId &&
              p.gangIndex === gangIndex &&
              p.controlledId === controlledId
            )
        )
      );
      try {
        await removeSwitchControl(selectedComponentId, gangIndex, controlledId);
      } catch (err) {
        setSwitchControls(before);
        setFloorSwitchControls(beforeFloor);
        toast.error(err instanceof Error ? err.message : 'Failed to unlink.');
      }
    },
    [selectedComponentId, switchControls, floorSwitchControls]
  );

  // === G20 gang→light drag-to-link ========================================
  //
  // The user can press-drag from a gang handle on the selected switch's pin
  // onto a light or outlet pin. While dragging, a thin dotted line follows
  // the pointer (rendered in viewbox coords inside .floor-plan so it lines
  // up with pins under any zoom/pan). On release, elementFromPoint resolves
  // the drop target by inspecting `data-link-target` + `data-pin-id`.
  //
  // The drop is silent on cancel/invalid (no toast spam) — only the success
  // path toasts. Duplicates are deduped by the INSERT OR IGNORE on the API.

  const startGangLinkDrag = useCallback(
    (
      switchId: string,
      gangIndex: number,
      origin: Point,
      e: ReactPointerEvent<HTMLElement>
    ): void => {
      e.preventDefault();
      e.stopPropagation();
      if (canvasRef.current === null) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const cur = viewport.screenToViewbox(e.clientX, e.clientY, rect);
      setLinkDrag({
        switchId,
        gangIndex,
        origin,
        current: { x: cur.x, y: cur.y },
        hoverPinId: null,
      });
    },
    [viewport]
  );

  // Global pointer listeners while a link drag is in flight.
  useEffect(() => {
    if (linkDrag === null) return;
    const onMove = (e: PointerEvent): void => {
      if (canvasRef.current === null) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const cur = viewport.screenToViewbox(e.clientX, e.clientY, rect);
      // Hit-test for a pin under the pointer. We check `data-link-target`
      // on the closest ancestor — only `light` / `outlet` qualify.
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const pinEl = el?.closest<HTMLElement>('[data-link-target]') ?? null;
      const target = pinEl?.dataset.linkTarget ?? null;
      const pinId =
        target === 'light' || target === 'outlet'
          ? (pinEl?.dataset.pinId ?? null)
          : null;
      setLinkDrag((prev) =>
        prev === null
          ? null
          : { ...prev, current: { x: cur.x, y: cur.y }, hoverPinId: pinId }
      );
    };
    const onUp = (e: PointerEvent): void => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const pinEl = el?.closest<HTMLElement>('[data-link-target]') ?? null;
      const target = pinEl?.dataset.linkTarget ?? null;
      const pinId = pinEl?.dataset.pinId ?? null;
      const drag = linkDrag;
      setLinkDrag(null);
      if (drag === null) return;
      if ((target === 'light' || target === 'outlet') && pinId !== null) {
        void (async () => {
          try {
            const link = await addSwitchControl(drag.switchId, drag.gangIndex, pinId);
            setSwitchControls((prev) => {
              const exists = prev.some(
                (p) => p.gangIndex === drag.gangIndex && p.controlled.id === pinId
              );
              return exists ? prev : [...prev, link];
            });
            // G38 cycle-64 — keep floor-wide feed in sync so the 3-way
            // badge + Controlled-by sidebar react immediately after a
            // successful drag-link.
            setFloorSwitchControls((prev) => {
              const exists = prev.some(
                (p) =>
                  p.switchId === drag.switchId &&
                  p.gangIndex === drag.gangIndex &&
                  p.controlledId === pinId
              );
              return exists
                ? prev
                : [
                    ...prev,
                    {
                      switchId: drag.switchId,
                      gangIndex: drag.gangIndex,
                      controlledId: pinId,
                    },
                  ];
            });
            toast.success(`Linked Gang ${drag.gangIndex + 1}`);
            // Refactor 2026-05 follow-up — refresh so the controlled
            // component's just-propagated breakerId (matching the switch)
            // is reflected in the drawer + pin tooltips. Backend POST
            // /controls also patches the controlled.breakerId = sw.breakerId.
            void refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to link.');
          }
        })();
      }
      // Release over nothing or unsupported target → silent cancel.
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', () => setLinkDrag(null));
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [linkDrag, viewport]);

  // === Editors ============================================================

  // G32 cycle-40 — wall + room editors are active in BOTH their dedicated
  // tool modes (draw new) AND in pointer mode (select / move / resize
  // existing). Draw affordances are still gated separately: the bg-rect
  // that captures pointerdown→draw is only rendered in the dedicated tool
  // modes. In pointer mode the hooks expose startEndpointDrag,
  // startCornerDrag, startTranslateDrag for handles + hit-rects.
  const wallEditor = useWallEditor({
    containerRef: canvasRef,
    active: (tool === 'wall' || tool === 'pointer') && floor !== null,
    screenToViewbox: viewport.screenToViewbox,
    onCommit: async (start, end) => {
      if (floor === null) return;
      if (start.x === end.x && start.y === end.y) return;
      const tempId = `tmp-${Date.now()}`;
      const optimistic: Wall = {
        id: tempId,
        floorId: floor.id,
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        createdAt: Date.now(),
      };
      setWalls((prev) => [...prev, optimistic]);
      try {
        const real = await createWall(floor.id, {
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
        setWalls((prev) => prev.map((w) => (w.id === wallId ? before : w)));
        toast.error(err instanceof Error ? err.message : 'Failed to move endpoint.');
      }
    },
  });

  const roomEditor = useRoomEditor({
    containerRef: canvasRef,
    active: (tool === 'room' || tool === 'pointer') && floor !== null,
    screenToViewbox: viewport.screenToViewbox,
    onCommit: async (rect) => {
      if (floor === null) return;
      if (rect.w === 0 || rect.h === 0) return;
      const trimmed = await prompt({
        title: 'New room',
        label: 'Name',
        defaultValue: 'Room',
        placeholder: 'e.g. Kitchen',
      });
      if (trimmed === null) return;
      // G42(a) cycle-49 — recursive create-with-409-retry. The geometry
      // is captured by closure; only the name varies between retries.
      const attemptCreateRoom = async (candidate: string): Promise<void> => {
        if (floor === null) return;
        const tempId = `tmp-${Date.now()}`;
        const optimistic: Room = {
          id: tempId,
          floorId: floor.id,
          name: candidate,
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          createdAt: Date.now(),
        };
        setRooms((prev) => [...prev, optimistic]);
        try {
          const real = await createRoom(floor.id, {
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
      const x = Math.min(newX, newRight);
      const y = Math.min(newY, newBottom);
      const w = Math.abs(newRight - newX);
      const h = Math.abs(newBottom - newY);
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
    /** G26 — translate the room AND all components whose pins fall
     *  inside its OLD rect. Optimistic local updates first, then PATCH
     *  the room, then PATCH each affected component. Per-row rollback
     *  on failure with a toast. */
    onTranslateCommit: async (roomId, dx, dy) => {
      const beforeRoom = rooms.find((r) => r.id === roomId);
      if (!beforeRoom) return;
      // Clamp the translated room so it stays inside the 0–10000 viewbox.
      const newX = Math.max(0, Math.min(10000 - beforeRoom.w, beforeRoom.x + dx));
      const newY = Math.max(0, Math.min(10000 - beforeRoom.h, beforeRoom.y + dy));
      // Recompute the effective delta after clamp (so contained pins
      // move by the same delta the room actually moves).
      const ddx = newX - beforeRoom.x;
      const ddy = newY - beforeRoom.y;
      if (ddx === 0 && ddy === 0) return;
      // Find every component whose pin is inside the OLD rect.
      const contained = findPointsInRect(componentsOnFloor, {
        x: beforeRoom.x,
        y: beforeRoom.y,
        w: beforeRoom.w,
        h: beforeRoom.h,
      });
      // Optimistic local update for the room + all contained pins.
      const patchedRoom: Room = { ...beforeRoom, x: newX, y: newY };
      const containedIds = new Set(contained.map((c) => c.id));
      setRooms((prev) => prev.map((r) => (r.id === roomId ? patchedRoom : r)));
      setComponentsOnFloor((prev) =>
        prev.map((c) => {
          if (!containedIds.has(c.id)) return c;
          const px = (c.posX ?? 0) + ddx;
          const py = (c.posY ?? 0) + ddy;
          // Clamp to viewbox.
          const clampedX = Math.max(0, Math.min(10000, px));
          const clampedY = Math.max(0, Math.min(10000, py));
          return {
            ...c,
            posX: clampedX,
            posY: clampedY,
            // Room association persists implicitly — the pin moves with
            // the room rect, so the auto-bind result is unchanged.
          };
        })
      );
      try {
        await updateRoom(roomId, { x: newX, y: newY });
      } catch (err) {
        setRooms((prev) => prev.map((r) => (r.id === roomId ? beforeRoom : r)));
        toast.error(err instanceof Error ? err.message : 'Failed to move room.');
        return; // skip component PATCHes if the room move itself failed
      }
      // PATCH each contained component independently. A failure for one
      // doesn't roll back the others — that's the same per-row policy
      // useOptimisticPatch follows elsewhere.
      await Promise.all(
        contained.map(async (c) => {
          if (c.posX === null || c.posY === null) return;
          const nx = Math.max(0, Math.min(10000, c.posX + ddx));
          const ny = Math.max(0, Math.min(10000, c.posY + ddy));
          try {
            await updateComponent(c.id, { posX: nx, posY: ny });
          } catch (err) {
            // Rollback just this component.
            setComponentsOnFloor((prev) =>
              prev.map((p) => (p.id === c.id ? c : p))
            );
            toast.error(
              err instanceof Error ? err.message : `Failed to move ${c.name}.`
            );
          }
        })
      );
    },
  });

  // === Delete handlers ====================================================

  const handleDeleteSelectedWall = useCallback(async (): Promise<void> => {
    if (selectedWallId === null) return;
    const id = selectedWallId;
    const before = walls.find((w) => w.id === id);
    if (!before) return;
    setSelectedWallId(null);
    setWalls((prev) => prev.filter((w) => w.id !== id));
    try {
      await deleteWall(id);
    } catch (err) {
      setWalls((prev) => [...prev, before]);
      toast.error(err instanceof Error ? err.message : 'Failed to delete wall.');
    }
  }, [selectedWallId, walls]);

  const handleDeleteSelectedRoom = useCallback(async (): Promise<void> => {
    if (selectedRoomId === null) return;
    const id = selectedRoomId;
    const before = rooms.find((r) => r.id === id);
    if (!before) return;
    setSelectedRoomId(null);
    setRooms((prev) => prev.filter((r) => r.id !== id));
    try {
      await deleteRoom(id);
    } catch (err) {
      setRooms((prev) => [...prev, before]);
      toast.error(err instanceof Error ? err.message : 'Failed to delete room.');
    }
  }, [rooms, selectedRoomId]);

  /**
   * G42(a) cycle-49 — rename-with-409-retry for rooms. Composite uniqueness
   * is (floor_id, name); the 409 message reflects the conflicting name.
   * Optimistic local rename; rolls back on any non-409 failure or when the
   * user cancels the retry prompt.
   */
  const attemptRenameRoom = useCallback(
    async (
      before: Room,
      candidate: string
    ): Promise<void> => {
      if (candidate === before.name) return;
      // Optimistic local rename.
      setRooms((prev) =>
        prev.map((r) => (r.id === before.id ? { ...r, name: candidate } : r))
      );
      try {
        await updateRoom(before.id, { name: candidate });
      } catch (err) {
        // Always roll back to canonical state before deciding next move.
        setRooms((prev) => prev.map((r) => (r.id === before.id ? before : r)));
        if (err instanceof ApiHttpError && err.status === 409) {
          const suggested = suffixDuplicate(candidate);
          toast.error(`Name "${candidate}" is taken — try "${suggested}"?`);
          const retry = await prompt({
            title: 'Pick a different name',
            label: 'Name',
            defaultValue: suggested,
          });
          if (retry === null) return;
          await attemptRenameRoom(before, retry);
          return;
        }
        toast.error(err instanceof Error ? err.message : 'Failed to rename room.');
      }
    },
    [prompt]
  );

  const handleRenameSelectedRoom = useCallback(async (): Promise<void> => {
    if (selectedRoomId === null) return;
    const before = rooms.find((r) => r.id === selectedRoomId);
    if (!before) return;
    const next = await prompt({
      title: 'Rename room',
      label: 'Name',
      defaultValue: before.name,
    });
    if (next === null || next === before.name) return;
    await attemptRenameRoom(before, next);
  }, [rooms, selectedRoomId, prompt, attemptRenameRoom]);

  /** G26 — commit a numeric edit to one of x/y/w/h on the selected room.
   *  Clamps to [0, 10000], snaps to 250 (the SNAP_STEP), no-ops on
   *  identity, optimistic local update + PATCH + rollback on failure. */
  const handleEditRoomDimension = useCallback(
    async (field: 'x' | 'y' | 'w' | 'h', rawNext: number): Promise<void> => {
      if (selectedRoomId === null) return;
      const before = rooms.find((r) => r.id === selectedRoomId);
      if (!before) return;
      // Clamp + snap. min 250 for w/h to avoid degenerate rects.
      let next = Number.isFinite(rawNext) ? rawNext : before[field];
      next = Math.max(0, Math.min(10000, Math.round(next / 250) * 250));
      if (field === 'w' || field === 'h') next = Math.max(250, next);
      if (next === before[field]) return;
      const patched: Room = { ...before, [field]: next };
      setRooms((prev) =>
        prev.map((r) => (r.id === before.id ? patched : r))
      );
      try {
        await updateRoom(before.id, { [field]: next });
      } catch (err) {
        setRooms((prev) => prev.map((r) => (r.id === before.id ? before : r)));
        toast.error(err instanceof Error ? err.message : 'Failed to update room.');
      }
    },
    [rooms, selectedRoomId]
  );

  // === Floor-level rename / delete (unchanged from cycle 15) =============

  /**
   * G42(a) cycle-49 — rename-with-409-retry. On UNIQUE conflict suggests a
   * suffixed candidate via a fresh prompt; user can accept or override.
   * Recursive so the suggestion path itself can also collide and re-prompt.
   */
  const attemptRenameFloor = useCallback(
    async (candidate: string): Promise<void> => {
      if (floor === null) return;
      if (candidate === floor.name) return;
      try {
        const updated = await updateFloor(floor.id, { name: candidate });
        if (!aliveRef.current) return;
        setFloor(updated);
        toast.success('Floor renamed');
      } catch (err) {
        if (err instanceof ApiHttpError && err.status === 409) {
          const suggested = suffixDuplicate(candidate);
          toast.error(`Name "${candidate}" is taken — try "${suggested}"?`);
          const retry = await prompt({
            title: 'Pick a different name',
            label: 'Name',
            defaultValue: suggested,
          });
          if (retry === null) return;
          await attemptRenameFloor(retry);
          return;
        }
        toast.error(err instanceof Error ? err.message : 'Failed to rename floor.');
      }
    },
    [floor, prompt]
  );

  const handleRenameFloor = async (): Promise<void> => {
    if (floor === null || acting) return;
    const next = await prompt({
      title: 'Rename floor',
      label: 'Name',
      defaultValue: floor.name,
    });
    if (next === null || next === floor.name) return;
    setActing(true);
    try {
      await attemptRenameFloor(next);
    } finally {
      if (aliveRef.current) setActing(false);
    }
  };

  /** Cycle-85 — link/unlink the floor's default panel. Components placed
   *  on this floor will pre-select this panel in the wiring section of
   *  ComponentForm. The user can still override per-component.
   *
   *  Optimistic update: flip local floor state first so the picker reflects
   *  the change immediately; revert on PATCH failure. */
  const handleSetLinkedPanel = useCallback(
    async (nextPanelId: string | null): Promise<void> => {
      if (floor === null || acting) return;
      // Short-circuit no-op (e.g. user re-picked the same option).
      if (floor.panelId === nextPanelId) return;
      const before = floor;
      setFloor({ ...floor, panelId: nextPanelId });
      setActing(true);
      try {
        const updated = await updateFloor(floor.id, { panelId: nextPanelId });
        if (aliveRef.current) {
          setFloor(updated);
          if (nextPanelId === null) {
            toast.success('Unlinked panel');
          } else {
            const p = panels.find((x) => x.id === nextPanelId);
            toast.success(`Linked floor to ${p?.name ?? 'panel'}`);
          }
        }
      } catch (err) {
        if (aliveRef.current) setFloor(before);
        toast.error(
          err instanceof Error ? err.message : 'Failed to update floor.'
        );
      } finally {
        if (aliveRef.current) setActing(false);
      }
    },
    [floor, acting, panels]
  );

  const handleDeleteFloor = async (): Promise<void> => {
    if (floor === null || acting) return;
    const count = componentsOnFloor.length;
    const message =
      count === 0
        ? `"${floor.name}" and all its walls and rooms will be permanently removed.`
        : `"${floor.name}" and all its walls and rooms will be permanently removed. ${count} component${count === 1 ? '' : 's'} will become floor-less (they survive without a floor).`;
    const ok = await confirm({
      title: 'Delete floor?',
      message,
      confirmLabel: 'Delete floor',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    setActing(true);
    try {
      await deleteFloor(floor.id);
      toast.success('Floor deleted');
      setLocation('/map');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete floor.');
      if (aliveRef.current) setActing(false);
    }
  };

  // === Keyboard shortcuts ================================================

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'v') setTool('pointer');
      else if (k === 'w') setTool('wall');
      else if (k === 'r') setTool('room');
      else if (k === 'o') setTool('outlet');
      else if (k === 'l') setTool('light');
      else if (k === 's') setTool('switch');
      else if (k === 'escape') {
        setSelectedWallId(null);
        setSelectedRoomId(null);
        setSelectedComponentId(null);
        wallEditor.reset();
        roomEditor.reset();
      } else if (k === 'delete' || k === 'backspace') {
        if (selectedWallId !== null) void handleDeleteSelectedWall();
        else if (selectedRoomId !== null) void handleDeleteSelectedRoom();
        else if (selectedComponentId !== null) void handleDeleteSelectedComponent();
      } else if (k === '0') {
        viewport.reset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    handleDeleteSelectedComponent,
    handleDeleteSelectedRoom,
    handleDeleteSelectedWall,
    selectedComponentId,
    roomEditor,
    selectedRoomId,
    selectedWallId,
    viewport,
    wallEditor,
  ]);

  // === Grouped panels list ===============================================

  const componentsByPanel = useMemo(() => {
    const groups = new Map<string, { panel: Panel; components: ResolvedComponent[] }>();
    for (const c of componentsOnFloor) {
      if (c.breaker === null) continue;
      const panel = panels.find((p) => p.id === c.breaker?.panelId);
      if (!panel) continue;
      const g = groups.get(panel.id);
      if (g) {
        g.components.push(c);
      } else {
        groups.set(panel.id, { panel, components: [c] });
      }
    }
    return Array.from(groups.values()).sort((a, b) =>
      a.panel.name.localeCompare(b.panel.name)
    );
  }, [componentsOnFloor, panels]);

  // === G26 translate-drag display overrides ==============================
  //
  // While roomEditor.translateDrag is non-null, the dragged room AND every
  // pin inside its OLD rect render at a shifted position for visual
  // feedback. Canonical state (rooms[] and componentsOnFloor[]) stays at
  // its pre-drag values until pointerup commits — that's what enables
  // smooth rollback if a PATCH fails.
  const displayedRooms = useMemo<Room[]>(() => {
    const td = roomEditor.translateDrag;
    if (td === null) return rooms;
    const dx = td.current.x - td.anchor.x;
    const dy = td.current.y - td.anchor.y;
    if (dx === 0 && dy === 0) return rooms;
    return rooms.map((r) =>
      r.id === td.roomId
        ? {
            ...r,
            x: Math.max(0, Math.min(10000 - r.w, r.x + dx)),
            y: Math.max(0, Math.min(10000 - r.h, r.y + dy)),
          }
        : r
    );
  }, [rooms, roomEditor.translateDrag]);

  const displayedComponentsOnFloor = useMemo<ResolvedComponent[]>(() => {
    const td = roomEditor.translateDrag;
    if (td === null) return componentsOnFloor;
    const beforeRoom = rooms.find((r) => r.id === td.roomId);
    if (!beforeRoom) return componentsOnFloor;
    const dx = td.current.x - td.anchor.x;
    const dy = td.current.y - td.anchor.y;
    if (dx === 0 && dy === 0) return componentsOnFloor;
    const containedIds = new Set(
      findPointsInRect(componentsOnFloor, beforeRoom).map((c) => c.id)
    );
    return componentsOnFloor.map((c) =>
      containedIds.has(c.id) && c.posX !== null && c.posY !== null
        ? {
            ...c,
            posX: Math.max(0, Math.min(10000, c.posX + dx)),
            posY: Math.max(0, Math.min(10000, c.posY + dy)),
          }
        : c
    );
  }, [componentsOnFloor, rooms, roomEditor.translateDrag]);

  // === Render ============================================================

  if (loading) {
    return (
      <div className="floor-edit">
        <div className="floor-edit__body">
          <ScreenHeader title="Loading floor…" back="/map" />
          <Skeleton variant="card" aria-label="Loading floor" />
        </div>
        {modalNode}
      </div>
    );
  }

  if (floor === null) {
    return (
      <div className="floor-edit">
        <div className="floor-edit__body">
          <ScreenHeader title="Not found" back="/map" />
          {/* EmptyState lucide-icon: error state (not list-empty) — cycle-76 ADR illustrations reserved for first-impression list-empty surfaces */}
          <EmptyState
            icon={<Pencil size={32} strokeWidth={1.5} />}
            title="Floor not found"
            description="It may have been deleted. Head back to the Map tab."
            action={
              <Link href="/map">
                <Button>Back to Map</Button>
              </Link>
            }
          />
        </div>
        {modalNode}
      </div>
    );
  }

  const planAspectStyle: CSSProperties | undefined =
    floor.floorPlan !== null
      ? { aspectRatio: `${floor.floorPlan.width} / ${floor.floorPlan.height}` }
      : undefined;

  const selectedWall = walls.find((w) => w.id === selectedWallId) ?? null;
  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;

  return (
    <div className="floor-edit">
      <div className="floor-edit__body">
        {(() => {
          // Refactor 2026-05 iter-6 — surface placed/unplaced counts in the
          // subtitle so the user knows at a glance how many components on
          // this floor still need to be positioned on the canvas.
          const placedCount = componentsOnFloor.filter(
            (c) => c.posX !== null && c.posY !== null
          ).length;
          const unplacedCount = componentsOnFloor.length - placedCount;
          const subtitle =
            componentsOnFloor.length === 0
              ? 'Floor editor'
              : unplacedCount === 0
                ? `${placedCount} ${placedCount === 1 ? 'component' : 'components'} placed`
                : `${placedCount} placed · ${unplacedCount} unplaced`;
          return (
            <ScreenHeader
              title={floor.name}
              subtitle={subtitle}
              back="/map"
            >
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Pencil size={16} strokeWidth={2.25} />}
            onClick={() => {
              void handleRenameFloor();
            }}
            disabled={acting}
          >
            Rename
          </Button>
        </ScreenHeader>
          );
        })()}

        <div className="floor-edit__layout">
          {/* === Tools sidebar (left) === */}
          <aside className="floor-edit__tools" aria-label="Tools">
            <ul className="tool-palette">
              <li>
                {/* Cycle-84 (P2 #8) — active state now styled via data-active
                    attribute on the .btn--ghost (NOT a new variant) — see
                    .tool-palette > li .btn[data-active] rules in styles.css. */}
                <Button
                  variant="ghost"
                  data-active={tool === 'pointer' || undefined}
                  block
                  leadingIcon={<MousePointer2 size={18} strokeWidth={2.25} />}
                  onClick={() => setTool('pointer')}
                >
                  Pointer
                  <span className="kbd-badge" aria-hidden="true">V</span>
                </Button>
              </li>
              <li>
                <Button
                  variant="ghost"
                  data-active={tool === 'wall' || undefined}
                  block
                  leadingIcon={<Pencil size={18} strokeWidth={2.25} />}
                  onClick={() => setTool('wall')}
                >
                  Wall
                  <span className="kbd-badge" aria-hidden="true">W</span>
                </Button>
              </li>
              <li>
                <Button
                  variant="ghost"
                  data-active={tool === 'room' || undefined}
                  block
                  leadingIcon={<Square size={18} strokeWidth={2.25} />}
                  onClick={() => setTool('room')}
                >
                  Room
                  <span className="kbd-badge" aria-hidden="true">R</span>
                </Button>
              </li>
              <li className="tool-palette__divider" aria-hidden="true" />
              {/* G19 quick-create tools — tap on canvas to drop a component. */}
              <li>
                <Button
                  variant="ghost"
                  data-active={tool === 'outlet' || undefined}
                  block
                  leadingIcon={<Power size={18} strokeWidth={2.25} />}
                  onClick={() => setTool('outlet')}
                >
                  Outlet
                  <span className="kbd-badge" aria-hidden="true">O</span>
                </Button>
              </li>
              <li>
                <Button
                  variant="ghost"
                  data-active={tool === 'light' || undefined}
                  block
                  leadingIcon={<Lightbulb size={18} strokeWidth={2.25} />}
                  onClick={() => setTool('light')}
                >
                  Light
                  <span className="kbd-badge" aria-hidden="true">L</span>
                </Button>
              </li>
              <li>
                <Button
                  variant="ghost"
                  data-active={tool === 'switch' || undefined}
                  block
                  leadingIcon={<ToggleRight size={18} strokeWidth={2.25} />}
                  onClick={() => setTool('switch')}
                >
                  Switch
                  <span className="kbd-badge" aria-hidden="true">S</span>
                </Button>
              </li>
              <li className="tool-palette__divider" aria-hidden="true" />
              <li>
                <Tooltip content="Reset zoom (0)">
                  <IconButton
                    icon={<ZoomIn size={18} strokeWidth={2.25} />}
                    aria-label="Reset zoom (0)"
                    variant="default"
                    onClick={() => viewport.reset()}
                  />
                </Tooltip>
              </li>
            </ul>
          </aside>

          {/* === Canvas (center) === */}
          <section className="floor-edit__canvas" aria-label="Floor canvas">
            <div
              ref={canvasRef}
              className={
                'floor-plan' +
                (floor.floorPlan === null ? ' floor-plan--vector-only' : '')
              }
              style={planAspectStyle}
              onWheel={viewport.onWheel}
              {...viewport.pinchHandlers}
            >
              {floor.floorPlan !== null && (
                // Underlay image is NOT transformed in cycle 16 — CSS-pixel
                // vs viewbox-unit mismatch makes a same-transform redundant
                // and a converted transform requires container-rect tracking.
                // The SVG geometry pans/zooms on top; the underlay stays
                // static. Documented in CLAUDE.md G15 section as a known
                // limitation to revisit.
                <img
                  src={floorPlanUrl(floor.floorPlan.filename)}
                  alt={`${floor.name} floor plan`}
                  className="floor-plan__img"
                  draggable={false}
                />
              )}
              <FloorPlanVectorOverlay
                walls={walls}
                rooms={displayedRooms}
                /* G32 cycle-40: highlight selections in pointer mode too,
                   not just the dedicated edit tools. */
                selectedWallId={
                  tool === 'wall' || tool === 'pointer' ? selectedWallId : null
                }
                selectedRoomId={
                  tool === 'room' || tool === 'pointer' ? selectedRoomId : null
                }
                transform={viewport.transformAttr}
                ghostWall={
                  tool === 'wall' &&
                  wallEditor.firstEndpoint &&
                  wallEditor.ghostEndpoint
                    ? {
                        x1: wallEditor.firstEndpoint.x,
                        y1: wallEditor.firstEndpoint.y,
                        x2: wallEditor.ghostEndpoint.x,
                        y2: wallEditor.ghostEndpoint.y,
                      }
                    : null
                }
                ghostRoom={
                  tool === 'room' && roomEditor.drawing
                    ? rectFromCorners(
                        roomEditor.drawing.anchor,
                        roomEditor.drawing.current
                      )
                    : null
                }
              />
              {/* Interactive layer per tool — wrapped in <g transform> so
                 hit-tests work through the viewport. */}
              {tool === 'wall' && (
                <svg
                  className="floor-plan__vector floor-plan__vector--interactive floor-plan__edit-capture"
                  viewBox="0 0 10000 10000"
                  preserveAspectRatio="none"
                  {...wallEditor.handlers}
                >
                  <g transform={viewport.transformAttr}>
                    <rect
                      x="0"
                      y="0"
                      width="10000"
                      height="10000"
                      fill="transparent"
                      onClick={(e) => {
                        if (selectedWallId !== null) {
                          e.stopPropagation();
                          setSelectedWallId(null);
                        }
                      }}
                    />
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
                    {wallEditor.firstEndpoint && (
                      <circle
                        cx={wallEditor.firstEndpoint.x}
                        cy={wallEditor.firstEndpoint.y}
                        r={90}
                        className="floor-plan__wall-handle"
                      />
                    )}
                    {selectedWallId !== null &&
                      (() => {
                        const sel = walls.find((w) => w.id === selectedWallId);
                        if (!sel) return null;
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
                  </g>
                </svg>
              )}
              {tool === 'room' && (
                <svg
                  className="floor-plan__vector floor-plan__vector--interactive floor-plan__edit-capture"
                  viewBox="0 0 10000 10000"
                  preserveAspectRatio="none"
                  {...roomEditor.handlers}
                >
                  <g transform={viewport.transformAttr}>
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
                    {rooms.map((r) => (
                      <rect
                        key={`rhit-${r.id}`}
                        x={r.x}
                        y={r.y}
                        width={r.w}
                        height={r.h}
                        className={
                          'floor-plan__room-hit' +
                          (selectedRoomId === r.id
                            ? ' floor-plan__room-hit--selected'
                            : '')
                        }
                        data-testid="room-hit"
                        data-room-id={r.id}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          // G26 — if the room is ALREADY selected, the
                          // pointerdown begins a translate drag. Otherwise
                          // it just selects (existing behavior).
                          if (selectedRoomId === r.id) {
                            roomEditor.startTranslateDrag(r.id, e);
                          } else {
                            setSelectedRoomId(r.id);
                          }
                        }}
                      />
                    ))}
                    {selectedRoomId !== null &&
                      (() => {
                        const sel = rooms.find((r) => r.id === selectedRoomId);
                        if (!sel) return null;
                        const drag = roomEditor.cornerDrag;
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
                  </g>
                </svg>
              )}
              {/* G32 cycle-40 — POINTER mode universal manipulation layer.
                 No bg-rect-with-onPointerDown (so no accidental draw); just
                 wall + room hit-rects for selection + endpoint/corner
                 handles for the active selection. Pin overlay is rendered
                 separately below (HTML buttons, not SVG). */}
              {tool === 'pointer' && (
                <svg
                  className="floor-plan__vector floor-plan__vector--interactive floor-plan__pointer-layer"
                  viewBox="0 0 10000 10000"
                  preserveAspectRatio="none"
                >
                  <g transform={viewport.transformAttr}>
                    {/* Empty-canvas tap deselects whichever wall/room is
                       selected (clicking on a hit-rect would stop
                       propagation before reaching this bg rect). */}
                    <rect
                      x="0"
                      y="0"
                      width="10000"
                      height="10000"
                      fill="transparent"
                      onClick={() => {
                        setSelectedWallId(null);
                        setSelectedRoomId(null);
                      }}
                    />
                    {/* Room hit-rects render FIRST (behind walls) so a
                       wall sitting on a room boundary is still tappable. */}
                    {rooms.map((r) => (
                      <rect
                        key={`prhit-${r.id}`}
                        x={r.x}
                        y={r.y}
                        width={r.w}
                        height={r.h}
                        className={
                          'floor-plan__room-hit' +
                          (selectedRoomId === r.id
                            ? ' floor-plan__room-hit--selected'
                            : '')
                        }
                        data-testid="pointer-room-hit"
                        data-room-id={r.id}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (selectedRoomId === r.id) {
                            roomEditor.startTranslateDrag(r.id, e);
                          } else {
                            setSelectedRoomId(r.id);
                            setSelectedWallId(null);
                          }
                        }}
                      />
                    ))}
                    {/* Wall hit-rects — tap to select. Endpoint drag fires
                       from the visible handles below. */}
                    {walls.map((w) => (
                      <line
                        key={`phit-${w.id}`}
                        x1={w.x1}
                        y1={w.y1}
                        x2={w.x2}
                        y2={w.y2}
                        className="floor-plan__wall-hit"
                        data-testid="pointer-wall-hit"
                        data-wall-id={w.id}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelectedWallId(w.id);
                          setSelectedRoomId(null);
                        }}
                      />
                    ))}
                    {/* Endpoint handles for the selected wall. */}
                    {selectedWallId !== null &&
                      (() => {
                        const sel = walls.find((w) => w.id === selectedWallId);
                        if (!sel) return null;
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
                    {/* Corner handles for the selected room. */}
                    {selectedRoomId !== null &&
                      (() => {
                        const sel = rooms.find((r) => r.id === selectedRoomId);
                        if (!sel) return null;
                        const drag = roomEditor.cornerDrag;
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
                  </g>
                </svg>
              )}
              {/* G19 quick-create capture layer — pointerdown on the canvas
                 creates a component at the snapped viewbox coord. */}
              {QUICK_CREATE_TOOLS.has(tool) && (
                <svg
                  className="floor-plan__vector floor-plan__vector--interactive floor-plan__edit-capture"
                  viewBox="0 0 10000 10000"
                  preserveAspectRatio="none"
                  onPointerDown={(e) => {
                    if (canvasRef.current === null) return;
                    const rect = canvasRef.current.getBoundingClientRect();
                    const pt = viewport.screenToViewbox(e.clientX, e.clientY, rect);
                    // Clamp to viewbox bounds.
                    const x = Math.max(0, Math.min(10000, pt.x));
                    const y = Math.max(0, Math.min(10000, pt.y));
                    void handleQuickCreate({ x, y });
                  }}
                >
                  <rect x="0" y="0" width="10000" height="10000" fill="transparent" />
                </svg>
              )}
              {/* Component pins overlay — absolutely-positioned buttons,
                 rendered above the SVG so they're tappable in pointer mode.
                 Each pin carries `data-link-target` + `data-pin-id` so the
                 G20 gang-link drag can hit-test via elementFromPoint.
                 G26 — also rendered (non-interactive, dimmed) during a room
                 translate so the user sees contained pins move with the room. */}
              {(tool === 'pointer' ||
                (tool === 'room' && roomEditor.translateDrag !== null)) &&
                displayedComponentsOnFloor
                  .filter((c) => c.posX !== null && c.posY !== null)
                  .map((c) => {
                    const left = ((c.posX ?? 0) / 10000) * 100;
                    const top = ((c.posY ?? 0) / 10000) * 100;
                    const isSel = selectedComponentId === c.id;
                    const isHoverTarget =
                      linkDrag !== null && linkDrag.hoverPinId === c.id;
                    const isInert = tool !== 'pointer';
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className={
                          'floor-plan__pin' +
                          (isSel ? ' floor-plan__pin--selected' : '') +
                          (isHoverTarget ? ' floor-plan__pin--link-target' : '') +
                          (isInert ? ' floor-plan__pin--inert' : '')
                        }
                        style={{ left: `${left}%`, top: `${top}%` } as CSSProperties}
                        onClick={isInert ? undefined : () => handleSelectComponent(c.id)}
                        aria-label={`${c.name} (${c.type})`}
                        title={c.name}
                        data-link-target={c.type}
                        data-pin-id={c.id}
                        id={`pin-${c.id}`}
                        tabIndex={isInert ? -1 : 0}
                      >
                        <ComponentTypePinIcon type={c.type} />
                      </button>
                    );
                  })}
              {/* G20 control-lines + in-flight gang-link drag layer.
                 Lives inside .floor-plan so the viewbox transform aligns it
                 with pins. pointer-events: none — purely decorative.
                 G38 cycle-64: now ALSO renders an inverse branch when a
                 co-controlled light is selected — one control-line from
                 EACH contributing switch to the light. */}
              {tool === 'pointer' &&
                (selectedComponentId !== null || linkDrag !== null) &&
                (() => {
                  const sel = componentsOnFloor.find(
                    (c) => c.id === selectedComponentId
                  );
                  const showControls =
                    sel !== undefined &&
                    sel.type === 'switch' &&
                    sel.posX !== null &&
                    sel.posY !== null;
                  // G38 cycle-64 — inverse branch. Fires only when the
                  // selected component is a light/outlet that's co-controlled
                  // (>=2 distinct switches). Avoids double-render: the
                  // existing forward branch only runs when sel is a SWITCH,
                  // so the two branches are mutually exclusive on `sel`.
                  const showInverse =
                    sel !== undefined &&
                    (sel.type === 'light' || sel.type === 'outlet') &&
                    sel.posX !== null &&
                    sel.posY !== null &&
                    coControlledIds.has(sel.id);
                  return (
                    <svg
                      className="floor-plan__link-layer"
                      data-testid="link-layer"
                      viewBox="0 0 10000 10000"
                      preserveAspectRatio="none"
                    >
                      <g transform={viewport.transformAttr}>
                        {/* US-005 — visible control lines from selected
                           switch (gang origin) to each controlled pin. */}
                        {showControls &&
                          switchControls.map((link) => {
                            const target = componentsOnFloor.find(
                              (c) => c.id === link.controlled.id
                            );
                            if (
                              target === undefined ||
                              target.posX === null ||
                              target.posY === null ||
                              sel === undefined ||
                              sel.posX === null ||
                              sel.posY === null
                            )
                              return null;
                            return (
                              <line
                                key={`${link.gangIndex}-${link.controlled.id}`}
                                x1={sel.posX}
                                y1={sel.posY}
                                x2={target.posX}
                                y2={target.posY}
                                className="floor-plan__control-line"
                                data-testid="control-line"
                                data-gang-index={link.gangIndex}
                                data-controlled-id={link.controlled.id}
                              />
                            );
                          })}
                        {/* G38 cycle-64 — inverse: lines FROM each
                           contributing switch TO the selected light.
                           Reuses .floor-plan__control-line styling per
                           the CLAUDE.md pin; data attrs disambiguate. */}
                        {showInverse &&
                          sel !== undefined &&
                          (() => {
                            // Local non-null capture — TS can't carry the
                            // showInverse narrowing into the inner map.
                            const selX = sel.posX;
                            const selY = sel.posY;
                            if (selX === null || selY === null) return null;
                            return (controlsByControlledId.get(sel.id) ?? []).map(
                              (link) => {
                                const sw = componentsOnFloor.find(
                                  (c) => c.id === link.switchId
                                );
                                if (
                                  sw === undefined ||
                                  sw.posX === null ||
                                  sw.posY === null
                                )
                                  return null;
                                return (
                                  <line
                                    key={`inv-${link.switchId}-${link.gangIndex}`}
                                    x1={sw.posX}
                                    y1={sw.posY}
                                    x2={selX}
                                    y2={selY}
                                    className="floor-plan__control-line"
                                    data-testid="control-line"
                                    data-gang-index={link.gangIndex}
                                    data-controlled-id={sel.id}
                                    data-switch-id={link.switchId}
                                  />
                                );
                              }
                            );
                          })()}
                        {/* US-004 — in-flight thin dotted drag line. */}
                        {linkDrag !== null && (
                          <line
                            x1={linkDrag.origin.x}
                            y1={linkDrag.origin.y}
                            x2={linkDrag.current.x}
                            y2={linkDrag.current.y}
                            className={
                              'floor-plan__link-drag' +
                              (linkDrag.hoverPinId !== null
                                ? ' floor-plan__link-drag--valid'
                                : '')
                            }
                            data-testid="link-drag-line"
                            data-valid-target={linkDrag.hoverPinId !== null ? 'true' : 'false'}
                          />
                        )}
                      </g>
                    </svg>
                  );
                })()}
              {/* G20 gang handles — when a switch is selected in pointer
                 mode, render small numbered drag affordances next to its
                 pin. Press-drag onto a light/outlet pin to link. */}
              {tool === 'pointer' &&
                selectedComponentId !== null &&
                (() => {
                  const sel = componentsOnFloor.find(
                    (c) => c.id === selectedComponentId
                  );
                  if (
                    sel === undefined ||
                    sel.type !== 'switch' ||
                    sel.posX === null ||
                    sel.posY === null
                  )
                    return null;
                  const left = (sel.posX / 10000) * 100;
                  const top = (sel.posY / 10000) * 100;
                  return (
                    <div
                      className="gang-link-handles"
                      data-testid="gang-handles"
                      data-switch-id={sel.id}
                      style={{ left: `${left}%`, top: `${top}%` } as CSSProperties}
                      aria-label={`Drag a Gang badge onto a light or outlet to link Gang's circuit`}
                    >
                      {Array.from({ length: sel.gangs }).map((_, gi) => {
                        // G38 cycle-64 — a gang earns the 3-way badge when
                        // ANY light/outlet it controls is co-controlled by
                        // >= 2 distinct switches (see coControlledIds memo).
                        const rowsForGang =
                          controlsBySwitchGang.get(`${sel.id}::${gi}`) ?? [];
                        const isThreeWay = rowsForGang.some((r) =>
                          coControlledIds.has(r.controlledId)
                        );
                        return (
                          <div
                            key={gi}
                            className="gang-link-handle-group"
                          >
                            <button
                              type="button"
                              className={
                                'gang-link-handle' +
                                (linkDrag !== null &&
                                linkDrag.switchId === sel.id &&
                                linkDrag.gangIndex === gi
                                  ? ' gang-link-handle--active'
                                  : '')
                              }
                              title={`Drag to link Gang ${gi + 1}`}
                              aria-label={`Drag to link Gang ${gi + 1}`}
                              data-testid="gang-handle"
                              data-gang-index={gi}
                              onPointerDown={(e) => {
                                if (sel.posX === null || sel.posY === null) return;
                                startGangLinkDrag(
                                  sel.id,
                                  gi,
                                  { x: sel.posX, y: sel.posY },
                                  e
                                );
                              }}
                            >
                              {gi + 1}
                            </button>
                            {isThreeWay && (
                              <Tooltip content="This gang co-controls a light with another switch">
                                <span
                                  className="three-way-badge"
                                  data-testid="three-way-badge"
                                  data-gang-index={gi}
                                  data-switch-id={sel.id}
                                  aria-label="3-way (co-controlled)"
                                  tabIndex={0}
                                >
                                  <GitFork
                                    size={11}
                                    strokeWidth={2.5}
                                    aria-hidden="true"
                                  />
                                  <span className="three-way-badge__text">3-way</span>
                                </span>
                              </Tooltip>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
            </div>
            <p className="muted floor-edit__caption">
              {walls.length} wall{walls.length === 1 ? '' : 's'} · {rooms.length} room
              {rooms.length === 1 ? '' : 's'} ·{' '}
              {componentsOnFloor.filter((c) => c.posX !== null).length} placed ·{' '}
              zoom {(viewport.viewport.scale * 100).toFixed(0)}%
            </p>
          </section>

          {/* === Properties sidebar (right) === */}
          <aside className="floor-edit__props" aria-label="Properties">
            {selectedWall !== null ? (
              <Card>
                <CardHeader>
                  <CardTitle as="h3">Wall</CardTitle>
                </CardHeader>
                <dl className="prop-list">
                  <div>
                    <dt>From</dt>
                    <dd>
                      {selectedWall.x1}, {selectedWall.y1}
                    </dd>
                  </div>
                  <div>
                    <dt>To</dt>
                    <dd>
                      {selectedWall.x2}, {selectedWall.y2}
                    </dd>
                  </div>
                </dl>
                <Button
                  variant="danger"
                  block
                  leadingIcon={<Trash2 size={16} strokeWidth={2.25} />}
                  onClick={() => {
                    void handleDeleteSelectedWall();
                  }}
                >
                  Delete wall
                </Button>
              </Card>
            ) : selectedRoom !== null ? (
              <Card>
                <CardHeader>
                  <CardTitle as="h3">Room</CardTitle>
                </CardHeader>
                <dl className="prop-list">
                  <div>
                    <dt>Name</dt>
                    <dd>
                      <button
                        type="button"
                        className="linklike"
                        onClick={() => {
                          void handleRenameSelectedRoom();
                        }}
                      >
                        {selectedRoom.name} <Pencil size={12} strokeWidth={2.25} />
                      </button>
                    </dd>
                  </div>
                </dl>
                {/* G26 — editable numeric dimensions. Snap step 250 matches
                    the canvas grid; clamped 0–10000. Commits on Enter or blur. */}
                <div className="room-dim-grid" data-testid="room-dim-grid">
                  <RoomDimensionInput
                    label="X"
                    value={selectedRoom.x}
                    onCommit={(v) => {
                      void handleEditRoomDimension('x', v);
                    }}
                    testId="room-dim-x"
                  />
                  <RoomDimensionInput
                    label="Y"
                    value={selectedRoom.y}
                    onCommit={(v) => {
                      void handleEditRoomDimension('y', v);
                    }}
                    testId="room-dim-y"
                  />
                  <RoomDimensionInput
                    label="W"
                    value={selectedRoom.w}
                    onCommit={(v) => {
                      void handleEditRoomDimension('w', v);
                    }}
                    testId="room-dim-w"
                  />
                  <RoomDimensionInput
                    label="H"
                    value={selectedRoom.h}
                    onCommit={(v) => {
                      void handleEditRoomDimension('h', v);
                    }}
                    testId="room-dim-h"
                  />
                </div>
                <p className="muted room-dim-hint">
                  Drag inside the rectangle to move it.
                </p>
                <Button
                  variant="danger"
                  block
                  leadingIcon={<Trash2 size={16} strokeWidth={2.25} />}
                  onClick={() => {
                    void handleDeleteSelectedRoom();
                  }}
                >
                  Delete room
                </Button>
              </Card>
            ) : selectedComponentId !== null ? (
              (() => {
                const sel = componentsOnFloor.find(
                  (c) => c.id === selectedComponentId
                );
                if (!sel) return null;
                const isSwitch = sel.type === 'switch';
                // G38 cycle-64 — for a light/outlet, compute the list of
                // switches controlling it (one entry per row). Each row is
                // clickable: navigates selection to that switch.
                const controlledByRows: Array<{
                  switchId: string;
                  switchName: string;
                  gangIndex: number;
                }> =
                  !isSwitch && (sel.type === 'light' || sel.type === 'outlet')
                    ? (controlsByControlledId.get(sel.id) ?? [])
                        .map((r) => {
                          const sw = componentsOnFloor.find(
                            (c) => c.id === r.switchId
                          );
                          return sw === undefined
                            ? null
                            : {
                                switchId: r.switchId,
                                switchName: sw.name,
                                gangIndex: r.gangIndex,
                              };
                        })
                        .filter(
                          (
                            x
                          ): x is {
                            switchId: string;
                            switchName: string;
                            gangIndex: number;
                          } => x !== null
                        )
                        // Stable ordering: switchName, then gangIndex.
                        .sort(
                          (a, b) =>
                            a.switchName.localeCompare(b.switchName) ||
                            a.gangIndex - b.gangIndex
                        )
                    : [];
                return (
                  <Card>
                    <CardHeader>
                      <CardTitle as="h3">{sel.name}</CardTitle>
                      <CardActions>
                        <button
                          type="button"
                          className="linklike"
                          style={{
                            fontSize: 'var(--text-size-sm)',
                          }}
                          onClick={() => {
                            void handleRenameSelectedComponent();
                          }}
                        >
                          Rename
                        </button>
                      </CardActions>
                    </CardHeader>
                    <dl className="prop-list">
                      <div>
                        <dt>Type</dt>
                        <dd>{sel.type}</dd>
                      </div>
                      {sel.room !== null && (
                        <div>
                          <dt>Room</dt>
                          <dd>{sel.room}</dd>
                        </div>
                      )}
                      {sel.posX !== null && sel.posY !== null && (
                        <div>
                          <dt>Position</dt>
                          <dd>
                            {sel.posX}, {sel.posY}
                          </dd>
                        </div>
                      )}
                      {isSwitch && (
                        <div>
                          <dt>Gangs</dt>
                          <dd>{sel.gangs}</dd>
                        </div>
                      )}
                    </dl>

                    {/* Refactor 2026-05 — breaker-context drawer. Closes the
                       user's #1 pre-refactor complaint: "I have no clear page
                       where I can click on a component on the map and see
                       which breaker slot it uses." When the selected pin has
                       a controlling breaker, render an inline summary + a
                       mini panel-viz with the controlling slot statically
                       highlighted (panel-viz__slot--active). When unwired,
                       prompt the user toward the existing Edit-details flow
                       (cycle-86 Modal). */}
                    {sel.breaker !== null ? (
                      <section
                        className="component-breaker-context"
                        data-testid="component-breaker-context"
                        data-breaker-id={sel.breaker.id}
                      >
                        <h4 className="section-title">Wired to</h4>
                        <p className="component-breaker-context__summary">
                          <Zap
                            size={14}
                            strokeWidth={2.25}
                            aria-hidden="true"
                          />{' '}
                          <Link
                            href={`/panels/${sel.breaker.panelId}`}
                            className="linklike"
                          >
                            {sel.breaker.panelName}
                          </Link>{' '}
                          <span className="muted">
                            · slot {sel.breaker.slot}
                            {sel.breaker.tandemHalf ?? ''} · {sel.breaker.amperage}A
                          </span>
                        </p>
                        <p className="component-breaker-context__label">
                          {sel.breaker.label}
                          {(() => {
                            const group = breakerGroups.find(
                              (g) => g.panel.id === sel.breaker!.panelId
                            );
                            const fullBreaker = group?.breakers.find(
                              (b) => b.id === sel.breaker!.id
                            );
                            return fullBreaker?.protection != null ? (
                              <>
                                {' '}
                                <ProtectionBadge kind={fullBreaker.protection} />
                              </>
                            ) : null;
                          })()}
                        </p>
                        {(() => {
                          const group = breakerGroups.find(
                            (g) => g.panel.id === sel.breaker!.panelId
                          );
                          if (group === undefined) return null;
                          return (
                            <div
                              className="panel-viz--mini"
                              data-testid="component-breaker-context-mini"
                            >
                              <PanelVisualization
                                panel={group.panel}
                                breakers={group.breakers}
                                highlightedBreakerId={sel.breaker!.id}
                              />
                            </div>
                          );
                        })()}
                        <Link
                          href={`/panels/${sel.breaker.panelId}#breaker-${sel.breaker.id}`}
                          className="component-breaker-context__cta"
                          data-testid="component-breaker-context-open-panel"
                        >
                          Open panel →
                        </Link>
                        {/* Refactor 2026-05 follow-up — inline breaker
                            picker. Switches auto-propagate to controlled
                            components server-side via the cycle-12 invariant. */}
                        <div
                          className="component-breaker-context__picker"
                          data-testid="component-breaker-context-picker"
                        >
                          <span className="component-breaker-context__picker-label">
                            Reassign
                          </span>
                          <BreakerPicker
                            value={sel.breaker.id}
                            groups={breakerGroups}
                            onChange={(next) => {
                              void handleAssignBreaker(next);
                            }}
                            ariaLabel="Reassign breaker"
                          />
                        </div>
                      </section>
                    ) : (
                      <section
                        className="component-breaker-context component-breaker-context--unwired"
                        data-testid="component-breaker-context"
                        data-unwired="true"
                      >
                        <p className="muted">
                          Not wired to a breaker yet.
                        </p>
                        {/* Refactor 2026-05 follow-up — inline breaker
                            picker, primary action when unwired. Switches
                            auto-propagate to controlled components on save. */}
                        <div
                          className="component-breaker-context__picker"
                          data-testid="component-breaker-context-picker"
                        >
                          <span className="component-breaker-context__picker-label">
                            Wire to a breaker
                          </span>
                          <BreakerPicker
                            value={null}
                            groups={breakerGroups}
                            onChange={(next) => {
                              void handleAssignBreaker(next);
                            }}
                            ariaLabel="Wire to a breaker"
                          />
                        </div>
                      </section>
                    )}

                    {/* G38 cycle-64 — "Controlled by" sidebar for a
                       light/outlet. Hidden when 0 switches; renders a
                       single inline line for 1 switch; renders a list of
                       clickable rows when >= 2 (the "3-way" / co-controlled
                       case). Each row navigates selection to that switch.
                       See CLAUDE.md "Three-way / co-controlled switches". */}
                    {!isSwitch &&
                      (sel.type === 'light' || sel.type === 'outlet') &&
                      controlledByRows.length > 0 && (
                        <div
                          className="controlled-by"
                          data-testid="controlled-by"
                        >
                          <h4 className="section-title">Controlled by</h4>
                          {controlledByRows.length === 1 ? (
                            <p className="controlled-by__single">
                              <button
                                type="button"
                                className="linklike"
                                data-testid="controlled-by-row"
                                data-switch-id={controlledByRows[0].switchId}
                                onClick={() => {
                                  setSelectedComponentId(
                                    controlledByRows[0].switchId
                                  );
                                }}
                              >
                                {controlledByRows[0].switchName}
                              </button>{' '}
                              <span className="muted">
                                · gang {controlledByRows[0].gangIndex + 1}
                              </span>
                            </p>
                          ) : (
                            <ul className="controlled-by__list">
                              {controlledByRows.map((row) => (
                                <li
                                  key={`${row.switchId}-${row.gangIndex}`}
                                  className="controlled-by__item"
                                >
                                  <CornerDownRight
                                    size={12}
                                    strokeWidth={2.25}
                                    aria-hidden="true"
                                    className="controlled-by__arrow"
                                  />
                                  <button
                                    type="button"
                                    className="linklike"
                                    data-testid="controlled-by-row"
                                    data-switch-id={row.switchId}
                                    onClick={() => {
                                      setSelectedComponentId(row.switchId);
                                    }}
                                  >
                                    {row.switchName}
                                  </button>
                                  <span className="muted">
                                    · gang {row.gangIndex + 1}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                    {isSwitch && (
                      <div className="gang-controls">
                        <h4 className="section-title">Controls</h4>
                        {Array.from({ length: sel.gangs }).map((_, gi) => {
                          const links = switchControls.filter(
                            (l) => l.gangIndex === gi
                          );
                          return (
                            <div key={gi} className="gang-row">
                              <div className="gang-row__label">Gang {gi + 1}</div>
                              <ul className="gang-row__chips">
                                {links.map((l) => (
                                  <li key={l.controlled.id} className="chip">
                                    <span>
                                      {l.controlled.name}{' '}
                                      <span className="muted">({l.controlled.type})</span>
                                    </span>
                                    <button
                                      type="button"
                                      className="chip__x"
                                      aria-label={`Unlink ${l.controlled.name}`}
                                      onClick={() => {
                                        void handleRemoveControl(gi, l.controlled.id);
                                      }}
                                    >
                                      <XIcon size={12} strokeWidth={2.5} />
                                    </button>
                                  </li>
                                ))}
                                <li>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      void handleAddControl(gi);
                                    }}
                                  >
                                    + Add
                                  </Button>
                                </li>
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Cycle-86 — opens ComponentForm in a Modal so the
                       user can wire the component to a panel/breaker (and
                       edit other fields) without leaving the floor map.
                       Reuses cycle-39 G31 wiring UI + cycle-85 floorPanelId
                       pre-selection verbatim. */}
                    <Button
                      variant="primary"
                      block
                      onClick={() => setEditingComponentId(sel.id)}
                      data-testid="floor-edit-component-edit"
                    >
                      Edit details
                    </Button>
                    <Button
                      variant="danger"
                      block
                      leadingIcon={<Trash2 size={16} strokeWidth={2.25} />}
                      onClick={() => {
                        void handleDeleteSelectedComponent();
                      }}
                    >
                      Delete component
                    </Button>
                  </Card>
                );
              })()
            ) : (
              // EmptyState lucide-icon: selection-placeholder + mobile-hidden (cycle-34 G28 styles.css:4007-4009); not list-empty
              <EmptyState
                icon={<MousePointer2 size={28} strokeWidth={1.5} />}
                title="Nothing selected"
                description={
                  QUICK_CREATE_TOOLS.has(tool)
                    ? 'Tap on the canvas to place a ' + tool + '.'
                    : tool === 'pointer'
                      ? 'Tap a shape or pin on the canvas, or pick a tool from the left.'
                      : 'Tap a shape on the canvas to see its details here.'
                }
              />
            )}

            {/* Cycle-85 — "Linked panel" picker. Setting a panel here
                makes ComponentForm pre-select that panel for any component
                placed on this floor (still overridable per-component). */}
            <section className="section">
              <h3 className="section-title">Linked panel</h3>
              <Select<string>
                id="floor-linked-panel"
                label={null}
                aria-label="Linked panel for default wiring"
                data-testid="floor-linked-panel"
                value={floor.panelId}
                onChange={(next) => {
                  void handleSetLinkedPanel(next);
                }}
                placeholder="None (no default panel)"
                options={panels.map((p) => ({ value: p.id, label: p.name }))}
                disabled={acting || panels.length === 0}
                hint={
                  panels.length === 0
                    ? 'Create a panel first to link it to this floor.'
                    : 'Components placed on this floor default-wire to this panel. You can override per-component.'
                }
              />
            </section>

            <section className="section">
              <h3 className="section-title">Panels here</h3>
              {componentsByPanel.length === 0 ? (
                <p className="muted">No components placed on this floor yet.</p>
              ) : (
                <ul className="panel-list__ul">
                  {componentsByPanel.map((g) => (
                    <li key={g.panel.id} className="panel-list__item">
                      <Link
                        href={`/panels/${g.panel.id}`}
                        className="panel-list__link"
                      >
                        <span className="panel-list__name">
                          <Zap size={14} strokeWidth={2.25} aria-hidden="true" />{' '}
                          {g.panel.name}
                        </span>
                        <span className="panel-list__meta">
                          {g.components.length}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="section section--danger">
              <h3 className="section-title">Danger zone</h3>
              <Button
                variant="danger"
                block
                leadingIcon={<Trash2 size={18} strokeWidth={2.25} />}
                onClick={() => {
                  void handleDeleteFloor();
                }}
                disabled={acting}
              >
                Delete floor
              </Button>
            </section>
          </aside>
        </div>
      </div>
      {/* Cycle-86 — Edit-details Modal hosting ComponentForm. Sheet
         presentation pivots to a bottom-anchored sheet below 720px
         (cycle-73) so the desktop floor-edit canvas + mobile both work.
         Mounted at screen root so the dialog overlays the whole editor.
         The form's onSubmit PATCHes the component and updates local
         state in place — no full refresh, preserves the user's pan/zoom. */}
      <Modal
        open={editingComponent !== null}
        onClose={() => setEditingComponentId(null)}
        title="Edit component"
        testId="floor-edit-component-modal"
        presentation="sheet"
      >
        {editingComponent !== null && floor !== null && (
          <FloorComponentEditFormHost
            component={editingComponent}
            breakerGroups={breakerGroups}
            roomSuggestions={roomSuggestions}
            floorPanelId={floor.panelId}
            onSubmit={async (input) => {
              try {
                const updated = await updateComponent(
                  editingComponent.id,
                  input
                );
                // Optimistic in-place update — widen Component back to
                // ResolvedComponent by looking up the new breaker's
                // owning panel + summary fields. breakerGroups carries
                // both the panel + its breakers, so we can synthesize the
                // ResolvedBreakerSummary shape without a refetch.
                let newBreakerSummary: ResolvedComponent['breaker'] = null;
                if (updated.breakerId !== null) {
                  for (const g of breakerGroups) {
                    const b = g.breakers.find(
                      (br) => br.id === updated.breakerId
                    );
                    if (b !== undefined) {
                      newBreakerSummary = {
                        id: b.id,
                        panelId: g.panel.id,
                        panelName: g.panel.name,
                        slot: b.slot,
                        slotPosition: b.slotPosition,
                        label: b.label,
                        amperage: b.amperage,
                        poles: b.poles,
                        tandemHalf: b.tandemHalf,
                      };
                      break;
                    }
                  }
                }
                setComponentsOnFloor((prev) =>
                  prev.map((c) =>
                    c.id === updated.id
                      ? { ...c, ...updated, breaker: newBreakerSummary }
                      : c
                  )
                );
                setEditingComponentId(null);
                toast.success('Saved');
              } catch (e) {
                toast.error(
                  e instanceof Error ? e.message : 'Failed to save.'
                );
              }
            }}
            onCancel={() => setEditingComponentId(null)}
          />
        )}
      </Modal>
      {modalNode}
    </div>
  );
};

/** Cycle-86 — small in-file host that wires useForm<ComponentInput> with
 *  the component's current values + renders <ComponentForm>. Mirrors the
 *  ComponentsScreen `EditingRow` pattern verbatim (same defaults, same
 *  field seeds) so a future cycle that touches one MUST touch the other. */
type FloorComponentEditFormHostProps = {
  component: ResolvedComponent;
  breakerGroups: PanelWithBreakers[];
  roomSuggestions: string[];
  floorPanelId: string | null;
  onSubmit: (input: ComponentInput) => Promise<void>;
  onCancel: () => void;
};

const FloorComponentEditFormHost = ({
  component,
  breakerGroups,
  roomSuggestions,
  floorPanelId,
  onSubmit,
  onCancel,
}: FloorComponentEditFormHostProps): JSX.Element => {
  const form = useForm<ComponentInput>({
    resolver: zodResolver(componentInputSchema),
    values: {
      type: component.type,
      name: component.name,
      room: component.room,
      notes: component.notes,
      // Cycle-39 G31 — seed breakerId so ComponentForm's Wiring section
      // initializes to the component's current wiring (and derives the
      // Panel select from it via breakerGroups lookup).
      breakerId: component.breakerId,
      // Cycle-59 G35 P2 — seed critical so the edit form shows current value.
      critical: component.critical,
      // Cycle-68 G37 — seed protection so the edit form shows current value.
      protection: component.protection,
    },
  });

  return (
    <ComponentForm
      form={form}
      onSubmit={(values) => onSubmit(values)}
      onCancel={onCancel}
      submitLabel="Save"
      breakerGroups={breakerGroups}
      roomSuggestions={roomSuggestions}
      floorPanelId={floorPanelId}
    />
  );
};

/** G26 — small uncontrolled numeric input for one of room's x/y/w/h.
 *  Commits on blur AND on Enter. Esc reverts to last-known value. Lives
 *  here (rather than ui/) because it's a narrow editor specific to room
 *  dimensions; promoting later if a second consumer shows up. */
const RoomDimensionInput = ({
  label,
  value,
  onCommit,
  testId,
}: {
  label: string;
  value: number;
  onCommit: (next: number) => void;
  testId: string;
}): JSX.Element => {
  const [draft, setDraft] = useState<string>(String(value));
  // Re-seed draft whenever the canonical value changes (e.g. via a drag
  // commit). Prevents stale user input from blocking external updates.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (): void => {
    const n = Number.parseInt(draft, 10);
    if (Number.isNaN(n)) {
      setDraft(String(value));
      return;
    }
    onCommit(n);
  };
  return (
    <label className="room-dim-input">
      <span className="room-dim-input__label">{label}</span>
      <Input
        label={null}
        type="number"
        inputMode="numeric"
        min={0}
        max={10000}
        step={250}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setDraft(String(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label={label}
        data-testid={testId}
      />
    </label>
  );
};

/** Tiny pin icon dispatcher — picks a lucide glyph per type. */
const ComponentTypePinIcon = ({ type }: { type: ComponentType }): JSX.Element => {
  // G26 cycle-32: dropped size 18 → 14 to match the new 32px pin (was 44).
  if (type === 'outlet') return <Power size={14} strokeWidth={2.25} aria-hidden="true" />;
  if (type === 'light') return <Lightbulb size={14} strokeWidth={2.25} aria-hidden="true" />;
  if (type === 'switch') return <ToggleRight size={14} strokeWidth={2.25} aria-hidden="true" />;
  // Fallback — appliance / junction_box / smoke_detector / other
  return <Zap size={12} strokeWidth={2.25} aria-hidden="true" />;
};
