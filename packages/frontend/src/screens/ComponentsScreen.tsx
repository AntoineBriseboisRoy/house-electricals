import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  Camera,
  ChevronDown,
  ClipboardList,
  Layers,
  Lightbulb,
  Map as MapIcon,
  Pencil,
  Plus,
  PowerOff,
  Search,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  componentInputSchema,
  type Component,
  type ComponentInput,
  type ComponentType,
  type Floor,
  type ResolvedComponent,
  type Room,
  type ServiceEntry,
} from '@he/shared';
import {
  createComponent,
  createComponentServiceEntry,
  deleteComponent,
  deleteServiceEntry,
  listAllBreakersGrouped,
  listAllRooms,
  listComponents,
  listFloors,
  listServiceEntries,
  updateComponent,
  type PanelWithBreakers,
} from '../api.js';
import {
  ComponentTypeIcon,
  componentTypeLabel,
} from '../components/ComponentTypeIcon.js';
import { ComponentForm } from '../components/ComponentForm.js';
import { PhotosModal } from '../components/PhotosModal.js';
import { ProtectionBadge } from '../components/ProtectionBadge.js';
import {
  computeOffState,
  groupBreakersByPanel,
  isComponentOff,
} from '../lib/breakerOff.js';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Checkbox,
  Combobox,
  EmptyState,
  FilterPopover,
  FilterTriggerButton,
  Input,
  Modal,
  NoComponents,
  ScreenHeader,
  SelectionBar,
  ServiceLogModal,
  Skeleton,
  SortDropdown,
  toast,
  Tooltip,
  type SortOption,
} from '../ui/index.js';
import { useFilterPopover } from '../hooks/useFilterPopover.js';
import { useFilterState } from '../hooks/useFilterState.js';
import { useModal } from '../hooks/useModal.js';
import { useMultiSelect } from '../hooks/useMultiSelect.js';
import { useOptimisticPatch } from '../hooks/useOptimisticPatch.js';
import { useUndoableDelete } from '../hooks/useUndoableDelete.js';

const ALL_TYPES: ComponentType[] = [
  'outlet',
  'light',
  'switch',
  'appliance',
  'junction_box',
  'smoke_detector',
  'other',
];

const readSearchFromUrl = (): string => {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('search') ?? '';
};

/**
 * Cycle-60 — filter + sort state for ComponentsScreen.
 *
 * Persisted via `useFilterState('he.components-filter', defaults)` (localStorage,
 * no URL sync). The `search` term still lives separately + flows through the
 * URL `?search=` query param (cycle-44/47 behavior preserved).
 */
type SortBy = 'name' | 'room' | 'created';
type SortOrder = 'asc' | 'desc';

/** 2026-05 — "Group by" buckets for the Library list. `none` = flat list. */
type GroupBy =
  | 'none'
  | 'type'
  | 'room'
  | 'protection'
  | 'breaker'
  | 'panel'
  | 'status';

const GROUP_OPTIONS: readonly { key: GroupBy; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'type', label: 'Type' },
  { key: 'room', label: 'Room' },
  { key: 'protection', label: 'Protection' },
  { key: 'breaker', label: 'Breaker / slot' },
  { key: 'panel', label: 'Panel' },
  { key: 'status', label: 'Status' },
];

type ComponentsFilterState = {
  room: string | null;
  type: ComponentType | null;
  /** When true, show only components flagged `critical`. Client-side filter
   *  (there's no backend `?critical=` query) — the DashboardScreen "View in
   *  library →" link sets it via a `?critical=1` deep-link param. */
  critical: boolean;
  sortBy: SortBy;
  sortOrder: SortOrder;
  /** 2026-05 — persisted "group by" choice. `useFilterState` shallow-merges
   *  over defaults, so older serialized state without this field reads as
   *  'none'. */
  groupBy: GroupBy;
};

const FILTER_STORAGE_KEY = 'he.components-filter';

const FILTER_DEFAULTS: ComponentsFilterState = {
  room: null,
  type: null,
  critical: false,
  sortBy: 'created',
  sortOrder: 'asc',
  groupBy: 'none',
};

const SORT_OPTIONS: readonly SortOption<SortBy>[] = [
  { sortBy: 'created', sortOrder: 'asc', label: 'Oldest first' },
  { sortBy: 'created', sortOrder: 'desc', label: 'Newest first' },
  { sortBy: 'name', sortOrder: 'asc', label: 'Name (A→Z)' },
  { sortBy: 'name', sortOrder: 'desc', label: 'Name (Z→A)' },
  { sortBy: 'room', sortOrder: 'asc', label: 'Room (A→Z)' },
  { sortBy: 'room', sortOrder: 'desc', label: 'Room (Z→A)' },
];

const sortComponents = (
  list: ResolvedComponent[],
  sortBy: SortBy,
  sortOrder: SortOrder
): ResolvedComponent[] => {
  const dir = sortOrder === 'asc' ? 1 : -1;
  const copy = [...list];
  copy.sort((a, b) => {
    if (sortBy === 'name') {
      return a.name.localeCompare(b.name) * dir;
    }
    if (sortBy === 'room') {
      // Nulls sort last regardless of direction.
      const ar = a.room ?? '';
      const br = b.room ?? '';
      if (ar === '' && br === '') return 0;
      if (ar === '') return 1;
      if (br === '') return -1;
      return ar.localeCompare(br) * dir;
    }
    // sortBy === 'created' — fall back to id for stable order when timestamps tie.
    if (a.createdAt !== b.createdAt) {
      return (a.createdAt - b.createdAt) * dir;
    }
    return a.id.localeCompare(b.id) * dir;
  });
  return copy;
};

export const ComponentsScreen = (): JSX.Element => {
  const [components, setComponents] = useState<ResolvedComponent[]>([]);
  const [loading, setLoading] = useState(true);
  // Cycle-60 — combined filter+sort state persisted to localStorage. The
  // `search` term still lives separately (URL-synced).
  const [filterState, setFilterState] = useFilterState<ComponentsFilterState>(
    FILTER_STORAGE_KEY,
    FILTER_DEFAULTS
  );
  const {
    room: filterRoom,
    type: filterType,
    critical: filterCritical,
    sortBy,
    sortOrder,
    groupBy,
  } = filterState;
  const [search, setSearch] = useState(() => readSearchFromUrl());
  const [searchInput, setSearchInput] = useState(() => readSearchFromUrl());
  const [editingId, setEditingId] = useState<string | null>(null);
  // Cycle-61-followup: "Add a component" is now a header CTA that opens a
  // Modal — was a big inline Card eating ~half the screen on a list view.
  const [addModalOpen, setAddModalOpen] = useState(false);
  const filterPopover = useFilterPopover();
  // 2026-05 — separate popover for the "Group by" pill (sibling to Filter).
  const groupPopover = useFilterPopover();
  // 2026-05 — which component cards are expanded (compact rows expand to the
  // full detail on click). Independent toggles (multiple can be open at once).
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const toggleExpanded = useCallback((id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  /** G31 cycle-39 — panels + their breakers, grouped, so the ComponentForm
   *  Wiring section can offer two cascading selects (Panel → Breaker).
   *  Fetched once on mount; refreshes after every save (since adding a
   *  component may have wired or unwired a breaker downstream). */
  const [breakerGroups, setBreakerGroups] = useState<PanelWithBreakers[]>([]);
  /** Cycle-85 — house-level rooms list (from GET /api/v1/rooms). Powers
   *  the ComponentForm Room datalist autocomplete via a union with the
   *  distinct-room set derived from `components`. Source of truth: the
   *  rooms table — typing "Kitchen" once on a floor map makes it
   *  available to every ComponentForm without ever placing a component
   *  in that room. */
  const [allRooms, setAllRooms] = useState<Room[]>([]);
  /** Cycle-85 — floors list, used to look up the linked panelId for a
   *  component being edited (when the component has a floorId). Powers
   *  the ComponentForm Panel pre-selection. */
  const [floors, setFloors] = useState<Floor[]>([]);
  /** G40 Part 2 cycle-67 — service-log entries keyed by component id. Mirrors
   *  the cycle-66 PanelDetailScreen pattern. When a component id is NOT in
   *  the map (e.g. still loading), the row hides the "Log · N" badge entirely
   *  (the row treats undefined as "don't render"). */
  const [serviceEntriesByComponentId, setServiceEntriesByComponentId] =
    useState<Map<string, ServiceEntry[]>>(new Map());
  /** G40 Part 2 cycle-67 — when non-null, render the ServiceLogModal for
   *  this component. */
  const [serviceLogComponentId, setServiceLogComponentId] = useState<string | null>(
    null
  );
  /** 2026-05 — when non-null, render the PhotosModal for the matching component. */
  const [photosComponentId, setPhotosComponentId] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // G42(c) cycle-47 — one-tap delete with a 30s undo toast replaces the
  // pre-cycle-47 confirm modal for component deletes. Floor + Panel
  // deletes still use confirm() (cascade semantics need a per-site undo
  // design — out of scope this cycle).
  const { confirm, pick, modalNode } = useModal();
  const { deleteWithUndo, deleteManyWithUndo } = useUndoableDelete();
  // G42(f) cycle-50 — bulk-actions support. The multi-select set lives
  // here (component-scoped, not URL/localStorage-persisted per the pin).
  // The optimistic-patch hook fans out N PATCHes for the "Assign breaker"
  // action — no backend bulk endpoint (Lockin OBJ1).
  const ms = useMultiSelect(components);
  const bulkAssign = useOptimisticPatch(
    async (id: string, body: { breakerId: string | null }) => {
      return updateComponent(id, body);
    }
  );

  // Reflect search into URL with a 250ms debounce; sync state immediately for the input.
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearch(searchInput.trim());
      const params = new URLSearchParams(window.location.search);
      if (searchInput.trim().length === 0) {
        params.delete('search');
      } else {
        params.set('search', searchInput.trim());
      }
      const next = params.toString();
      // Refactor 2026-05 — preserve whichever path the user entered through
      // (canonical /library or back-compat /components) so refresh + history
      // stay consistent. The screen is the SAME ComponentsScreen either way.
      const pathname = window.location.pathname.startsWith('/library')
        ? '/library'
        : '/components';
      const url = `${pathname}${next ? `?${next}` : ''}`;
      setLocation(url, { replace: true });
    }, 250);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchInput, setLocation]);

  // DashboardScreen "View in library →" deep-link. A `?critical=1` param
  // arrives with the critical filter pre-applied so the user lands on the
  // exact subset the Status card counted. Consume it ONCE on mount into the
  // persisted filter state, then strip it from the URL so it doesn't linger
  // or re-trigger on subsequent renders.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('critical') !== '1') return;
    setFilterState((prev) => ({ ...prev, critical: true }));
    params.delete('critical');
    const next = params.toString();
    const pathname = window.location.pathname.startsWith('/library')
      ? '/library'
      : '/components';
    setLocation(`${pathname}${next ? `?${next}` : ''}`, { replace: true });
    // Mount-only: this is a one-shot URL → filter handoff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // G25 cycle-28 — listAllBreakersGrouped fetch removed: the inline
  // BreakerPicker dropdown in component rows was retired in favor of
  // clicking Edit + using ComponentForm. One fewer page-load API call.

  const createForm = useForm<ComponentInput>({
    resolver: zodResolver(componentInputSchema),
    defaultValues: {
      type: 'outlet',
      name: '',
      room: null,
      notes: null,
      breakerId: null,
      critical: false,
      // G37 cycle-68 — default to null (no protection) on create.
      protection: null,
      // 2026-05 — load (watts) unknown by default; the form offers a typical.
      loadWatts: null,
    },
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const filter: Parameters<typeof listComponents>[0] = {};
      if (filterRoom !== null && filterRoom.trim().length > 0) {
        filter.room = filterRoom.trim();
      }
      if (filterType !== null) filter.type = filterType;
      if (search.length > 0) filter.search = search;
      // G31 cycle-39 — load components + grouped breakers in parallel.
      // Cycle-85 — also load all rooms (for the Room datalist suggestions)
      // and all floors (so the EditingRow can resolve a component's floor
      // → floor.panelId default for the Panel select).
      const [comps, groups, rooms, fls] = await Promise.all([
        listComponents(filter),
        listAllBreakersGrouped(),
        listAllRooms(),
        listFloors(),
      ]);
      setComponents(comps);
      setBreakerGroups(groups);
      setAllRooms(rooms);
      setFloors(fls);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load components.');
    } finally {
      setLoading(false);
    }
  }, [filterRoom, filterType, search]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** G40 Part 2 cycle-67 — bulk-fetch service entries for every loaded
   *  component in ONE round-trip (via ?parentIds=). Mirrors the cycle-66
   *  PanelDetailScreen pattern. Lazy + non-blocking; the badge hides if
   *  this fails. */
  const refreshServiceEntries = useCallback(async (): Promise<void> => {
    if (components.length === 0) {
      setServiceEntriesByComponentId(new Map());
      return;
    }
    try {
      const { data } = await listServiceEntries({
        parentType: 'component',
        parentIds: components.map((c) => c.id),
      });
      const byId = new Map<string, ServiceEntry[]>();
      for (const c of components) byId.set(c.id, []);
      for (const e of data) {
        const arr = byId.get(e.parentId);
        if (arr !== undefined) arr.push(e);
      }
      setServiceEntriesByComponentId(byId);
    } catch {
      // best-effort — the badge just hides if this fails (the row treats
      // undefined `serviceLogCount` as "don't render the badge").
    }
  }, [components]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await refreshServiceEntries();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshServiceEntries]);

  const handleCreate = async (input: ComponentInput): Promise<void> => {
    try {
      await createComponent(input);
      createForm.reset({
        type: 'outlet',
        name: '',
        room: null,
        notes: null,
        breakerId: null,
      });
      // Cycle-61-followup: close the modal on success.
      setAddModalOpen(false);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add component.');
    }
  };

  const handleUpdate = async (id: string, patch: Partial<ComponentInput>): Promise<void> => {
    try {
      await updateComponent(id, patch);
      setEditingId(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save component.');
    }
  };

  // Cycle-44 G42(d) — reset all filter inputs in a single helper so the
  // "No components match your filters" EmptyState CTA has one click-to-
  // clear surface. Cycle-60 extends it to clear the room+type filters
  // (now persisted under filterState) and resets sort to default.
  const clearFilters = useCallback((): void => {
    setSearchInput('');
    setFilterState(FILTER_DEFAULTS);
  }, [setFilterState]);

  // Cycle-60 — derive the distinct list of room names from the loaded
  // components so the Room Combobox can offer typeahead suggestions. Drop
  // nulls/empties and sort alphabetically. Memoized so the option list is
  // stable between renders unless the underlying components list changes.
  const roomOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of components) {
      if (c.room !== null && c.room.trim().length > 0) {
        set.add(c.room);
      }
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((room) => ({ value: room, label: room }));
  }, [components]);

  /** Cycle-85 — room suggestions for the ComponentForm Room datalist.
   *  Union of (a) all rooms drawn on any floor map (via GET /rooms) AND
   *  (b) distinct room names typed on existing components. (b) handles
   *  free-text rooms the user typed without ever drawing them on a map;
   *  (a) handles rooms drawn on a map but not yet wired to a component.
   *  Note this is INDEPENDENT of `roomOptions` (the filter-popover
   *  Combobox), which only lists rooms in use — the filter widens the
   *  search; the form widens placement. */
  const roomSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRooms) {
      if (r.name.trim().length > 0) set.add(r.name);
    }
    for (const c of components) {
      if (c.room !== null && c.room.trim().length > 0) set.add(c.room);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allRooms, components]);

  /** Cycle-85 — map floor.id → floor.panelId so EditingRow can resolve
   *  a component's `floorId` to a default Panel for the wiring section.
   *  When the floor has no linked panel, the lookup returns undefined and
   *  EditingRow falls through to "no default" (user picks the panel
   *  manually). */
  const floorPanelByFloorId = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const f of floors) m.set(f.id, f.panelId);
    return m;
  }, [floors]);

  // Cycle-60 — sort happens client-side over the server-filtered list.
  // The server returns canonical `created_at ASC, id ASC` (per CLAUDE.md
  // "Search filters, never reorders") so we don't break that contract.
  // The `critical` flag has no backend query, so it's filtered client-side
  // here over the already server-filtered set, before sorting.
  const visibleComponents = useMemo(() => {
    const filtered = filterCritical
      ? components.filter((c) => c.critical === true)
      : components;
    return sortComponents(filtered, sortBy, sortOrder);
  }, [components, filterCritical, sortBy, sortOrder]);

  // G37 cycle-68 — map breakerId → protection so the ComponentsScreen breaker
  // chip can show the badge alongside the slot label. ResolvedBreakerSummary
  // does NOT currently include `protection` — the data is sourced from
  // `breakerGroups` (already loaded for the Wiring section) so we don't
  // widen the resolved-breaker join just for this surface.
  const breakerProtectionById = useMemo(() => {
    const map = new Map<string, ResolvedComponent['protection']>();
    for (const { breakers } of breakerGroups) {
      for (const b of breakers) {
        if (b.protection !== null) map.set(b.id, b.protection);
      }
    }
    return map;
  }, [breakerGroups]);

  // 2026-05 — off-state for the whole house, derived from the already-loaded
  // breakerGroups. A component whose wired breaker is off (directly or via an
  // upstream feeder) gets an "Off" badge + de-energized row.
  const offState = useMemo(
    () =>
      computeOffState(
        breakerGroups.map((g) => g.panel),
        groupBreakersByPanel(breakerGroups)
      ),
    [breakerGroups]
  );

  // 2026-05 — "Group by" bucketing. Returns a stable { key, label } per
  // component for the active grouping. `~`-prefixed keys are the
  // "missing"/catch-all buckets (No room / Unassigned / No protection) and
  // sort to the bottom.
  const groupValueOf = useCallback(
    (c: ResolvedComponent): { key: string; label: string } => {
      switch (groupBy) {
        case 'type':
          return { key: c.type, label: componentTypeLabel(c.type) };
        case 'room':
          return c.room
            ? { key: c.room, label: c.room }
            : { key: '~none', label: 'No room' };
        case 'protection': {
          const p =
            c.protection ??
            (c.breaker ? breakerProtectionById.get(c.breaker.id) ?? null : null);
          return p
            ? { key: p, label: p.toUpperCase() }
            : { key: '~none', label: 'No protection' };
        }
        case 'breaker':
          return c.breaker
            ? {
                key: c.breaker.id,
                label: `Slot ${c.breaker.slot}${c.breaker.tandemHalf ?? ''} · ${c.breaker.label}`,
              }
            : { key: '~unassigned', label: 'Unassigned' };
        case 'panel':
          return c.breaker
            ? { key: c.breaker.panelId, label: c.breaker.panelName }
            : { key: '~unassigned', label: 'Unassigned' };
        case 'status':
          return c.breakerId === null
            ? { key: '~unassigned', label: 'Unassigned' }
            : isComponentOff(offState, c)
              ? { key: 'off', label: 'Off' }
              : { key: 'on', label: 'On' };
        default:
          return { key: '', label: '' };
      }
    },
    [groupBy, breakerProtectionById, offState]
  );

  const groupedComponents = useMemo(() => {
    if (groupBy === 'none') {
      return [{ key: '', label: '', items: visibleComponents }];
    }
    const map = new Map<
      string,
      { key: string; label: string; items: ResolvedComponent[] }
    >();
    for (const c of visibleComponents) {
      const { key, label } = groupValueOf(c);
      let g = map.get(key);
      if (g === undefined) {
        g = { key, label, items: [] };
        map.set(key, g);
      }
      g.items.push(c);
    }
    return [...map.values()].sort((a, b) => {
      // Catch-all (~) buckets last; otherwise alphabetical by label.
      const aSentinel = a.key.startsWith('~');
      const bSentinel = b.key.startsWith('~');
      if (aSentinel !== bSentinel) return aSentinel ? 1 : -1;
      return a.label.localeCompare(b.label);
    });
  }, [groupBy, visibleComponents, groupValueOf]);

  const groupLabel =
    GROUP_OPTIONS.find((g) => g.key === groupBy)?.label ?? 'None';

  // Cycle-60 — count of active filters (excluding search, which has its
  // own input above). Drives the badge on the Filter pill.
  const activeFilterCount =
    (filterRoom !== null ? 1 : 0) +
    (filterType !== null ? 1 : 0) +
    (filterCritical ? 1 : 0);
  const hasAnyFilter =
    searchInput.trim() !== '' ||
    filterRoom !== null ||
    filterType !== null ||
    filterCritical;

  // G42(c) cycle-47 — one-tap delete + 30s undo. Snapshot the current
  // list so undo can restore the exact pre-delete order (the canonical
  // sort is created_at ASC + id ASC, but the prevList memo preserves
  // exactly what the user saw). The server DELETE is held by
  // useUndoableDelete for 30s and fires only if no undo.
  const handleDelete = (id: string): void => {
    const target = components.find((c) => c.id === id);
    if (!target) return;
    const prevList = components;
    deleteWithUndo({
      id,
      resourceType: 'component',
      label: target.name,
      removeOptimistically: () => {
        setComponents((cur) => cur.filter((c) => c.id !== id));
      },
      restore: () => {
        setComponents(prevList);
      },
      commit: async () => {
        await deleteComponent(id);
      },
      onCommitted: () => {
        // No refresh needed — the optimistic removal already matches
        // the server's post-commit state.
      },
    });
  };

  // G42(f) cycle-50 — bulk delete with confirm + batched undo. Per the
  // CLAUDE.md ADR, bulk delete keeps the confirm modal even though single-
  // row delete (cycle-47) dropped it — it's destructive enough that the
  // confirm + undo combo is the right level of friction.
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
        // Auto-pruning the selection: clear right away so the bar
        // dismisses with the bulk action.
        ms.clear();
      },
      restore: () => {
        setComponents(prevList);
      },
      resourceNamePlural:
        selected.length === 1 ? 'component' : 'components',
    });
  }, [components, confirm, deleteManyWithUndo, ms]);

  // G42(f) cycle-50 — bulk assign breaker via N sequential PATCHes
  // (NO backend bulk endpoint — Lockin OBJ1). Reuses the same picker
  // shape that EditingRow's ComponentForm uses for single-row assign.
  const handleBulkAssign = useCallback(async (): Promise<void> => {
    const selected = ms.selectedItems;
    if (selected.length === 0) return;
    // Build flat list of (panelName › breakerLabel) options across all
    // grouped breakers. Same option shape ComponentForm flattens.
    type Option = { value: string | null; label: string; hint?: string };
    const options: Option[] = [
      { value: null, label: 'Unassigned', hint: 'Clear the breaker on all selected' },
    ];
    for (const { panel, breakers } of breakerGroups) {
      for (const b of breakers) {
        const pos = b.slotPosition !== null ? `slot ${b.slotPosition}` : '';
        const half =
          b.poles === 'tandem' && b.tandemHalf !== null ? b.tandemHalf : '';
        const slot = pos ? `${pos}${half} · ` : '';
        options.push({
          value: b.id,
          label: `${slot}${b.label} · ${b.amperage}A`,
          hint: panel.name,
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
    // pick() returns null on cancel. The "Unassigned" sentinel is also
    // value: null — distinguish via picker semantics: the modal calls
    // onPick(value) only when the user clicks an option, vs onCancel
    // resolving null. There's no way to disambiguate from the caller's
    // side without changing the modal contract; in practice "Unassigned"
    // is a meaningful action so we route it through. If the user
    // cancelled with no selection it's also null — same as picking
    // Unassigned. Acceptable for v1 since (a) Unassigned is already in
    // the picker and (b) re-running the picker is cheap.
    if (picked === null) return;
    // Optimistic: snapshot the original wiring for each row so the
    // useOptimisticPatch retry can be observed by the user but we can
    // still re-render with the new breakerId immediately.
    const optimisticPatch = {
      breakerId: picked,
    };
    // Resolve the picked breaker's resolved chip (so the row chip
    // updates without a full refresh). null means unassigned.
    let resolvedBreaker: ResolvedComponent['breaker'] = null;
    if (picked !== null) {
      for (const { panel, breakers } of breakerGroups) {
        const b = breakers.find((x) => x.id === picked);
        if (b !== undefined) {
          resolvedBreaker = {
            id: b.id,
            label: b.label,
            slot: b.slot,
            slotPosition: b.slotPosition,
            poles: b.poles,
            tandemHalf: b.tandemHalf ?? null,
            amperage: b.amperage,
            panelId: panel.id,
            panelName: panel.name,
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
    // Fan out N PATCHes via useOptimisticPatch. allSettled because one
    // failure shouldn't poison the rest. Errors surface as a follow-up
    // toast; the hook also tracks per-id errors which we don't display
    // here (the bar dismisses on success).
    const results = await Promise.allSettled(
      targetIds.map((id) => bulkAssign.patch(id, optimisticPatch))
    );
    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected'
    );
    // useOptimisticPatch resolves with null on failure (it doesn't throw),
    // so we also count null-results as failures.
    const nullResults = results.filter(
      (r) => r.status === 'fulfilled' && r.value === null
    );
    const totalFailures = failures.length + nullResults.length;
    if (totalFailures === 0) {
      toast.success(
        `Assigned ${targetIds.length} component${targetIds.length === 1 ? '' : 's'}.`
      );
      ms.clear();
      // Refresh so the canonical sort + any server-side derived fields
      // re-populate. The optimistic state above already shows the
      // user the right thing in the meantime.
      void refresh();
    } else if (totalFailures === targetIds.length) {
      toast.error(`Failed to assign breaker on ${targetIds.length} components.`);
      // Roll back the optimistic patch.
      void refresh();
    } else {
      toast.error(
        `${totalFailures} of ${targetIds.length} components failed to assign.`
      );
      ms.clear();
      void refresh();
    }
  }, [breakerGroups, bulkAssign, ms, pick, refresh]);

  /** G40 Part 2 cycle-67 — ServiceLogModal handlers + derived state.
   *  Mirrors the cycle-66 PanelDetailScreen pattern (same shape, swapped
   *  parent type / label). */
  const serviceLogComponent = useMemo(
    () =>
      serviceLogComponentId === null
        ? null
        : components.find((c) => c.id === serviceLogComponentId) ?? null,
    [serviceLogComponentId, components]
  );
  const serviceLogLabel = serviceLogComponent?.name ?? '';
  const serviceLogEntries =
    serviceLogComponentId === null
      ? []
      : serviceEntriesByComponentId.get(serviceLogComponentId) ?? [];

  const handleAddServiceEntry = useCallback(
    async (input: { note: string; occurredAt: number }): Promise<void> => {
      if (serviceLogComponentId === null) return;
      try {
        await createComponentServiceEntry(serviceLogComponentId, input);
        toast.success('Service entry added');
        await refreshServiceEntries();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : 'Failed to add service entry.'
        );
        throw e;
      }
    },
    [serviceLogComponentId, refreshServiceEntries]
  );

  const handleDeleteServiceEntry = useCallback(
    async (id: string): Promise<void> => {
      try {
        await deleteServiceEntry(id);
        toast.success('Entry removed');
        await refreshServiceEntries();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : 'Failed to remove entry.'
        );
      }
    },
    [refreshServiceEntries]
  );

  // Memo'd selection-bar actions — extracted so the JSX below stays
  // readable. Disabled state propagates from the optimistic-patch
  // pending set (so the user can't fire Assign twice in a row before
  // the first batch settles).
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

  return (
    <>
      <ScreenHeader
        title="Library"
        subtitle="Every component in the house — outlets, lights, switches, appliances."
      >
        <Button
          variant="primary"
          size="sm"
          leadingIcon={<Plus size={16} strokeWidth={2.25} />}
          onClick={() => setAddModalOpen(true)}
          data-testid="open-add-component"
          aria-label="Add a component"
        >
          Component
        </Button>
      </ScreenHeader>

      <Card>
        <CardTitle className="visually-hidden">Search</CardTitle>
        <Input
          label={null}
          aria-label="Search components"
          type="search"
          inputMode="search"
          placeholder="Search name, room, or notes…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          autoComplete="off"
          leadingIcon={<Search size={16} strokeWidth={2.25} />}
        />
        {/* Cycle-60 — replaces the prior "Filter" Card with text Room +
            native Type select. Pill toolbar of Filter (popover with Type
            chips + Room typeahead Combobox) and Sort (client-side). */}
        <div
          className="filter-toolbar"
          data-testid="components-filter-toolbar"
        >
          <FilterTriggerButton
            ref={filterPopover.buttonRef}
            label="Filter"
            count={activeFilterCount}
            active={activeFilterCount > 0}
            onClick={filterPopover.toggle}
            testId="components-filter-trigger"
            ariaLabel="Filter components"
          />
          <SortDropdown<SortBy>
            options={SORT_OPTIONS}
            currentSortBy={sortBy}
            currentSortOrder={sortOrder}
            onSort={(nextBy, nextOrder) =>
              setFilterState((prev) => ({
                ...prev,
                sortBy: nextBy,
                sortOrder: nextOrder,
              }))
            }
            testId="components-sort"
          />
          {/* 2026-05 — Group-by pill (sibling to Filter/Sort). Opens a
              FilterPopover with the grouping options as chips (same look as
              the Type filter). Buckets the list by Type / Room / Protection /
              Breaker / Panel / Status. */}
          <FilterTriggerButton
            ref={groupPopover.buttonRef}
            icon={Layers}
            label={groupBy === 'none' ? 'Group' : `Group: ${groupLabel}`}
            active={groupBy !== 'none'}
            onClick={groupPopover.toggle}
            testId="components-group-trigger"
            ariaLabel="Group components"
          />
          {activeFilterCount > 0 && (
            // Cycle-70 polish-pass-2 P2 #14 — was variant="ghost" (bare
            // text), looked like body copy next to the FilterTriggerButton
            // pill. Secondary variant gives it a clear button shape that
            // matches the pill's bg-surface-raised + border aesthetic.
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setFilterState((prev) => ({
                  ...prev,
                  room: null,
                  type: null,
                  critical: false,
                }))
              }
              data-testid="components-filter-clear"
            >
              Clear filters
            </Button>
          )}
        </div>
      </Card>

      <FilterPopover
        isOpen={groupPopover.isOpen}
        popoverRef={groupPopover.popoverRef}
        position={groupPopover.position}
        ariaLabel="Group components"
        testId="components-group-popover"
      >
        <div className="filter-popover__section">
          <h3 className="filter-popover__section-title">Group by</h3>
          <div
            className="filter-popover__chips"
            role="group"
            aria-label="Group by"
          >
            {GROUP_OPTIONS.map((g) => (
              <button
                key={g.key}
                type="button"
                className={
                  groupBy === g.key
                    ? 'filter-popover__chip filter-popover__chip--active'
                    : 'filter-popover__chip'
                }
                onClick={() => {
                  setFilterState((prev) => ({ ...prev, groupBy: g.key }));
                  groupPopover.close();
                }}
                data-testid="components-group-option"
                data-group={g.key}
                aria-pressed={groupBy === g.key}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </FilterPopover>

      <FilterPopover
        isOpen={filterPopover.isOpen}
        popoverRef={filterPopover.popoverRef}
        position={filterPopover.position}
        ariaLabel="Component filters"
        testId="components-filter-popover"
      >
        <div className="filter-popover__section">
          <h3 className="filter-popover__section-title">Type</h3>
          <div className="filter-popover__chips" role="group" aria-label="Filter by type">
            <button
              type="button"
              className={
                filterType === null
                  ? 'filter-popover__chip filter-popover__chip--active'
                  : 'filter-popover__chip'
              }
              onClick={() =>
                setFilterState((prev) => ({ ...prev, type: null }))
              }
              data-testid="filter-type-chip"
              data-value=""
              aria-pressed={filterType === null}
            >
              All
            </button>
            {ALL_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={
                  filterType === t
                    ? 'filter-popover__chip filter-popover__chip--active'
                    : 'filter-popover__chip'
                }
                onClick={() =>
                  setFilterState((prev) => ({ ...prev, type: t }))
                }
                data-testid="filter-type-chip"
                data-value={t}
                aria-pressed={filterType === t}
              >
                {componentTypeLabel(t)}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-popover__section">
          <h3 className="filter-popover__section-title">Room</h3>
          <Combobox<string>
            value={filterRoom}
            onChange={(next) =>
              setFilterState((prev) => ({ ...prev, room: next }))
            }
            options={roomOptions}
            placeholder={
              roomOptions.length === 0
                ? 'No rooms on any component yet'
                : 'Any room'
            }
            ariaLabel="Filter by room"
            testId="filter-room-combobox"
            emptyMessage="No matching rooms"
            disabled={roomOptions.length === 0}
          />
        </div>
        <div className="filter-popover__section">
          <h3 className="filter-popover__section-title">Flags</h3>
          <div
            className="filter-popover__chips"
            role="group"
            aria-label="Filter by flag"
          >
            <button
              type="button"
              className={
                filterCritical
                  ? 'filter-popover__chip filter-popover__chip--active'
                  : 'filter-popover__chip'
              }
              onClick={() =>
                setFilterState((prev) => ({
                  ...prev,
                  critical: !prev.critical,
                }))
              }
              data-testid="filter-critical-chip"
              aria-pressed={filterCritical}
            >
              Critical only
            </button>
          </div>
        </div>
        <div className="filter-popover__footer">
          {/* Cycle-70 polish-pass-2 P2 #14 — was variant="ghost" (bare text).
              Secondary gives a clear button shape paired with the primary
              "Done", establishing hierarchy: Done = canonical action,
              Clear = alternative. */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setFilterState((prev) => ({
                ...prev,
                room: null,
                type: null,
                critical: false,
              }));
            }}
            disabled={activeFilterCount === 0}
            data-testid="filter-popover-clear"
          >
            Clear
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={filterPopover.close}
            data-testid="filter-popover-done"
          >
            Done
          </Button>
        </div>
      </FilterPopover>

      {/* Cycle-61-followup: Add-a-component lives in a Modal triggered by the
          ScreenHeader CTA. Was an always-visible Card eating ~half the screen
          on what's primarily a list view. Cancel + Close (X) dismiss; success
          auto-closes via handleCreate. */}
      <Modal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title="Add a component"
        testId="add-component-modal"
        presentation="sheet"
      >
        <ComponentForm
          form={createForm}
          onSubmit={handleCreate}
          submitLabel="Add component"
          onCancel={() => setAddModalOpen(false)}
          breakerGroups={breakerGroups}
          roomSuggestions={roomSuggestions}
        />
      </Modal>

      <section aria-labelledby="components-heading" className="section">
        <h2 id="components-heading" className="section-title">
          All components
        </h2>
        {loading ? (
          <Skeleton variant="row" count={5} aria-label="Loading components" />
        ) : visibleComponents.length === 0 ? (
          // Cycle-44 G42(d) — split branch. When ANY filter is active and
          // results are empty, the user wants a one-click escape (Clear
          // filters). When NO filter is active (truly-empty state), the
          // create-form sits directly above so we omit the CTA per the
          // create-form-adjacency rule. Cycle-60 — `hasAnyFilter` consumes
          // the new filterState (room + type) plus the search box.
          hasAnyFilter ? (
            // EmptyState lucide-icon: filtered-empty branch (cycle-76 ADR — first-impression illustrations only)
            <EmptyState
              icon={<Lightbulb size={32} strokeWidth={1.5} />}
              title="No components match your filters"
              description="Try clearing them, or add new components from the form above."
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              illustration={<NoComponents />}
              title="No components yet"
              description="Add your first outlet, light, switch, or appliance using the form above."
            />
          )
        ) : (
          groupedComponents.map((group) => (
            <div key={group.key || '~all'} className="component-group">
              {groupBy !== 'none' && (
                <div
                  className="component-group__head"
                  data-testid="component-group-head"
                  data-group-key={group.key}
                >
                  <span className="component-group__label">{group.label}</span>
                  <span className="component-group__count">
                    {group.items.length}
                  </span>
                  <span className="component-group__rule" aria-hidden="true" />
                </div>
              )}
              <ul className="component-list">
                {group.items.map((c) =>
                  editingId === c.id ? (
                <EditingRow
                  key={c.id}
                  component={c}
                  breakerGroups={breakerGroups}
                  roomSuggestions={roomSuggestions}
                  floorPanelId={
                    c.floorId !== null
                      ? floorPanelByFloorId.get(c.floorId) ?? null
                      : null
                  }
                  onCancel={() => setEditingId(null)}
                  onSave={(patch) => handleUpdate(c.id, patch)}
                />
              ) : (
                /* 2026-05 — compact, expandable card (matches the breaker
                   design-1 language). The COLLAPSED row is a dense one-liner:
                   checkbox + icon + name (+ critical/off/unassigned) + "Type ·
                   Room · ⚡slot" + quick actions (map/photos/edit/delete) + an
                   expand chevron. Clicking the body (or the chevron) reveals
                   the DETAIL — the full breaker chip, protection, service log,
                   and notes. The detail is always in the DOM (CSS-toggled) so
                   the breaker chip stays countable for bulk-actions e2e. */
                (() => {
                  const isOff = isComponentOff(offState, c);
                  const isExpanded = expandedIds.has(c.id);
                  const logCount = serviceEntriesByComponentId.get(c.id)?.length;
                  return (
                    <li
                      key={c.id}
                      className={
                        'component-row' +
                        (ms.isSelected(c.id) ? ' component-row--selected' : '') +
                        (isOff ? ' component-row--off' : '') +
                        (isExpanded ? ' component-row--expanded' : '')
                      }
                      data-testid="component-row"
                      data-component-id={c.id}
                      data-selected={ms.isSelected(c.id) ? 'true' : 'false'}
                      data-off={isOff ? 'true' : undefined}
                    >
                      <div className="component-row__row">
                        <span className="component-row__select">
                          <Checkbox
                            checked={ms.isSelected(c.id)}
                            onChange={() => ms.toggle(c.id)}
                            ariaLabel={`Select ${c.name}`}
                            testId="component-row-checkbox"
                          />
                        </span>
                        {/* Click the body to expand (mouse). Keyboard users use
                            the chevron button. */}
                        <div
                          className="component-row__main"
                          onClick={() => toggleExpanded(c.id)}
                        >
                          <span className="component-row__icon" aria-hidden="true">
                            <ComponentTypeIcon type={c.type} />
                          </span>
                          <div className="component-row__identity">
                            <div className="component-row__name-line">
                              <span className="component-row__name">{c.name}</span>
                              {c.critical && (
                                <Tooltip content="Marked as critical (priority for backup power)">
                                  <span
                                    className="badge badge--critical"
                                    data-testid="badge-critical"
                                    tabIndex={0}
                                  >
                                    <AlertTriangle size={11} strokeWidth={2.5} aria-hidden="true" />
                                    <span>Critical</span>
                                  </span>
                                </Tooltip>
                              )}
                              {c.breakerId === null && (
                                <Badge tone="warn">Unassigned</Badge>
                              )}
                              {isOff && (
                                <Badge
                                  tone="warn"
                                  data-testid="component-off-badge"
                                  data-target-component-id={c.id}
                                >
                                  <PowerOff size={11} strokeWidth={2.5} aria-hidden="true" />
                                  <span>Off</span>
                                </Badge>
                              )}
                            </div>
                            <div className="component-row__meta">
                              <span>{componentTypeLabel(c.type)}</span>
                              {c.room !== null && <span>· {c.room}</span>}
                              {c.breaker !== null && (
                                <span className="component-row__meta-slot">
                                  ·{' '}
                                  <Zap size={11} strokeWidth={2.5} aria-hidden="true" />
                                  slot {c.breaker.slot}
                                  {c.breaker.tandemHalf ?? ''}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="component-row__quick">
                          {c.floorId !== null &&
                            c.posX !== null &&
                            c.posY !== null && (
                              <Tooltip content="View on floor plan">
                                <Link
                                  href={`/floors/${c.floorId}/edit#pin-${c.id}`}
                                  className="component-row__map-link"
                                  aria-label={`View ${c.name} on the floor plan`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MapIcon size={16} strokeWidth={2.25} aria-hidden="true" />
                                </Link>
                              </Tooltip>
                            )}
                          <button
                            type="button"
                            className="component-row__expand"
                            onClick={() => toggleExpanded(c.id)}
                            aria-expanded={isExpanded}
                            aria-label={
                              isExpanded
                                ? `Collapse ${c.name} details`
                                : `Expand ${c.name} details`
                            }
                            data-testid="component-row-expand"
                            data-target-component-id={c.id}
                          >
                            <ChevronDown
                              size={18}
                              strokeWidth={2.25}
                              aria-hidden="true"
                              className="component-row__expand-chev"
                            />
                          </button>
                        </div>
                      </div>

                      {/* Detail — always rendered, CSS-shown when expanded. */}
                      <div className="component-row__detail">
                        {c.breaker !== null ? (
                          <Link
                            href={`/panels/${c.breaker.panelId}#breaker-${c.breaker.id}`}
                            className="component-row__breaker-chip"
                            aria-label={`Show breaker ${c.breaker.label} on ${c.breaker.panelName}`}
                          >
                            <Zap size={14} strokeWidth={2.25} aria-hidden="true" />
                            <span className="component-row__breaker-chip-label">
                              {c.breaker.panelName} · slot {c.breaker.slot}
                              {c.breaker.tandemHalf ?? ''} · {c.breaker.label}
                            </span>
                            <span className="component-row__breaker-chip-amp">
                              {c.breaker.amperage}A
                            </span>
                            {breakerProtectionById.has(c.breaker.id) && (
                              <ProtectionBadge
                                kind={breakerProtectionById.get(c.breaker.id)!}
                              />
                            )}
                          </Link>
                        ) : (
                          <span className="component-row__breaker-chip component-row__breaker-chip--unwired">
                            Not wired to any breaker
                          </span>
                        )}
                        {(c.protection !== null || logCount !== undefined) && (
                          <div className="component-row__detail-row">
                            {c.protection !== null && (
                              <ProtectionBadge kind={c.protection} />
                            )}
                            {logCount !== undefined && (
                              <button
                                type="button"
                                className={
                                  'component-row__service-log' +
                                  (logCount === 0
                                    ? ' component-row__service-log--empty'
                                    : '')
                                }
                                onClick={() => setServiceLogComponentId(c.id)}
                                data-testid="component-row-service-log"
                                data-target-component-id={c.id}
                                data-log-count={logCount}
                                aria-label={
                                  logCount === 0
                                    ? 'Open service log (empty)'
                                    : `Open service log (${logCount} entries)`
                                }
                                title={
                                  logCount === 0
                                    ? 'No service entries yet'
                                    : `${logCount} service entries`
                                }
                              >
                                <ClipboardList
                                  size={12}
                                  strokeWidth={2.25}
                                  aria-hidden="true"
                                  className="component-row__service-log-icon"
                                />
                                <span className="component-row__service-log-text">
                                  Log · {logCount}
                                </span>
                              </button>
                            )}
                          </div>
                        )}
                        {c.notes !== null && c.notes.trim().length > 0 && (
                          <p className="component-row__notes">{c.notes}</p>
                        )}
                        <div className="component-row__detail-actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            leadingIcon={<Camera size={15} strokeWidth={2.25} />}
                            onClick={() => setPhotosComponentId(c.id)}
                            aria-label={`Photos for ${c.name}`}
                            data-testid="component-row-photos"
                            data-target-component-id={c.id}
                          >
                            Photos
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            leadingIcon={<Pencil size={15} strokeWidth={2.25} />}
                            onClick={() => setEditingId(c.id)}
                            aria-label={`Edit component ${c.name}`}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            leadingIcon={<Trash2 size={15} strokeWidth={2.25} />}
                            onClick={() => handleDelete(c.id)}
                            aria-label={`Delete component ${c.name}`}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })()
                  )
                )}
              </ul>
            </div>
          ))
        )}
      </section>
      {modalNode}
      {/* G42(f) cycle-50 — portal-mounted SelectionBar at document.body so
          the CSS `body:has(.selection-bar)` selector matches and hides
          BottomTabs. Only mounts while ≥1 row is selected. */}
      {ms.count > 0 &&
        createPortal(
          <SelectionBar
            count={ms.count}
            onClear={ms.clear}
            actions={selectionActions}
          />,
          document.body
        )}
      {/* G40 Part 2 cycle-67 — ServiceLogModal for component-parent. Mirrors
          the cycle-66 PanelDetailScreen mount pattern (same modal, parent
          type='component'). */}
      {serviceLogComponentId !== null && (
        <ServiceLogModal
          open
          parentLabel={serviceLogLabel}
          parentType="component"
          entries={serviceLogEntries}
          onAddEntry={handleAddServiceEntry}
          onDeleteEntry={handleDeleteServiceEntry}
          onClose={() => setServiceLogComponentId(null)}
        />
      )}
      {photosComponentId !== null && (
        <PhotosModal
          open
          parentType="component"
          parentId={photosComponentId}
          parentLabel={
            components.find((c) => c.id === photosComponentId)?.name
          }
          onClose={() => setPhotosComponentId(null)}
        />
      )}
    </>
  );
};

type EditingRowProps = {
  component: Component;
  breakerGroups: PanelWithBreakers[];
  /** Cycle-85 — distinct room names pulled from rooms-on-floors + rooms-on-
   *  components; passed through to ComponentForm for the Room datalist. */
  roomSuggestions: string[];
  /** Cycle-85 — the component's floor's linked panel id (or null when
   *  unlinked / no floor). Passed through to ComponentForm so the Panel
   *  select defaults to this when the component itself isn't yet wired. */
  floorPanelId: string | null;
  onCancel: () => void;
  onSave: (patch: Partial<ComponentInput>) => Promise<void>;
};

const EditingRow = ({
  component,
  breakerGroups,
  roomSuggestions,
  floorPanelId,
  onCancel,
  onSave,
}: EditingRowProps): JSX.Element => {
  const form = useForm<ComponentInput>({
    resolver: zodResolver(componentInputSchema),
    values: {
      type: component.type,
      name: component.name,
      room: component.room,
      notes: component.notes,
      // G31 cycle-39 — seed breakerId so the form's Wiring section
      // initializes to the component's current wiring. The form derives
      // the Panel select from this id by looking it up in breakerGroups.
      breakerId: component.breakerId,
      // G35 Part 2 cycle-59 — seed critical so the edit form shows the
      // current value of the flag.
      critical: component.critical,
      // G37 cycle-68 — seed protection so the edit form shows current value.
      protection: component.protection,
      // 2026-05 — seed load (watts) so the edit form shows the current value.
      loadWatts: component.loadWatts,
    },
  });

  return (
    <li className="component-row component-row--editing">
      <ComponentForm
        form={form}
        onSubmit={(values) => onSave(values)}
        onCancel={onCancel}
        submitLabel="Save"
        breakerGroups={breakerGroups}
        roomSuggestions={roomSuggestions}
        floorPanelId={floorPanelId}
      />
    </li>
  );
};
