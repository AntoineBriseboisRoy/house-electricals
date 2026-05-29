import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useRoute } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowUpFromLine,
  ChevronUp,
  Map as MapIcon,
  Plus,
  Printer,
  Zap,
} from 'lucide-react';
import {
  breakerInputSchema,
  type Breaker,
  type BreakerInput,
  type BreakerTest,
  type Floor,
  type Panel,
  type ResolvedComponent,
  type ServiceEntry,
} from '@he/shared';
import { ComponentTypeIcon } from '../components/ComponentTypeIcon.js';
import { ProtectionBadge } from '../components/ProtectionBadge.js';
import {
  createBreaker,
  createBreakerServiceEntry,
  deleteBreaker,
  deletePanel,
  deleteServiceEntry,
  getPanel,
  latestBreakerTestsByIds,
  listAllBreakersGrouped,
  listBreakers,
  listComponents,
  listFloors,
  listPanels,
  listServiceEntries,
  updateBreaker,
  updatePanel,
} from '../api.js';
import { BreakerForm } from '../components/BreakerForm.js';
import { BreakerWithComponents } from '../components/BreakerWithComponents.js';
import {
  Button,
  Card,
  CardActions,
  CardHeader,
  CardTitle,
  EmptyState,
  ImpactModal,
  MoveToBuildingButton,
  NoBreakers,
  NoComponents,
  PanelVisualization,
  ScreenHeader,
  ServiceLogModal,
  Skeleton,
  toast,
} from '../ui/index.js';
import { useModal } from '../hooks/useModal.js';
import { useUndoableDelete } from '../hooks/useUndoableDelete.js';
import { computeImpact } from '../lib/impact.js';

type ViewMode = 'viz' | 'list';
const VIEW_KEY = 'he.panel-view';
const readView = (): ViewMode => {
  if (typeof window === 'undefined') return 'viz';
  const v = window.localStorage.getItem(VIEW_KEY);
  return v === 'list' ? 'list' : 'viz';
};

export const PanelDetailScreen = (): JSX.Element => {
  const [, params] = useRoute<{ id: string }>('/panels/:id');
  const panelId = params?.id ?? '';

  const [panel, setPanel] = useState<Panel | null>(null);
  const [breakers, setBreakers] = useState<Breaker[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  /** G25 cycle-24 — components wired to any of this panel's breakers,
   *  grouped client-side by breakerId for the side-by-side configure view. */
  const [panelComponents, setPanelComponents] = useState<ResolvedComponent[]>([]);
  /** G39 cycle-56 — every panel in the house. Used to:
   *   - Build the `subpanelsByFeederBreakerId` map for PanelVisualization.
   *   - Populate the "Feeds subpanel" picker in BreakerForm.
   *   - Render the "Fed by" card on this screen.
   *   - G35 Part 1 (cycle-58) — feed computeImpact's cascade walker. */
  const [allPanels, setAllPanels] = useState<Panel[]>([]);
  /** G35 Part 1 (cycle-58) — every component in the house (unfiltered).
   *  Needed to find cascade-off components on subpanels, which live
   *  outside this panel's `panelComponents` filter. */
  const [allComponents, setAllComponents] = useState<ResolvedComponent[]>([]);
  /** G35 Part 1 (cycle-58) — every breaker on every panel, keyed by panel
   *  id. Threaded into computeImpact for the cascade walker. */
  const [breakersByPanel, setBreakersByPanel] = useState<
    ReadonlyMap<string, readonly Breaker[]>
  >(new Map());
  /** G35 Part 1 (cycle-58) — floors for the Impact modal's name lookup. */
  const [floors, setFloors] = useState<Floor[]>([]);
  /** G35 Part 1 (cycle-58) — when non-null, render the Impact modal for
   *  the matching breaker. */
  const [impactBreakerId, setImpactBreakerId] = useState<string | null>(null);
  /** G39 cycle-56 — parent breaker info resolved LAZILY only when this
   *  panel is a subpanel. Fetched after the main panel load to avoid
   *  blocking initial render (and the Add-a-breaker toggle). Null when
   *  unloaded or when not a subpanel. */
  const [parentBreakerInfo, setParentBreakerInfo] = useState<{
    breaker: Breaker;
    panelName: string;
  } | null>(null);
  /** G36 cycle-61 — latest BreakerTest per breaker id (null if no test
   *  exists for that breaker). Loaded lazily after the critical-path
   *  refresh resolves so the initial render isn't slowed. Undefined-not-
   *  in-map ≠ null-in-map: missing means "still loading"; null means
   *  "no test ever". The BreakerRow consumer interprets `undefined` →
   *  hide the hint entirely, `null` → "Last verified: never". */
  const [lastTestByBreakerId, setLastTestByBreakerId] = useState<
    Map<string, BreakerTest | null>
  >(new Map());
  /** G40 Part 1 cycle-66 — service-log entries keyed by breaker id. The
   *  map is the entries-for-that-breaker arrays (DESC-sorted). Loaded
   *  lazily after critical-path refresh resolves (same pattern as
   *  lastTestByBreakerId). Empty array (key present) ≠ missing key
   *  (still loading). The ServiceLogModal consumer reads from this. */
  const [serviceEntriesByBreakerId, setServiceEntriesByBreakerId] =
    useState<Map<string, ServiceEntry[]>>(new Map());
  /** G40 Part 1 cycle-66 — when non-null, render the ServiceLogModal for
   *  the matching breaker. */
  const [serviceLogBreakerId, setServiceLogBreakerId] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>(readView);
  const { confirm, prompt, pick, modalNode } = useModal();
  const { deleteWithUndo } = useUndoableDelete();

  const switchView = (next: ViewMode): void => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // localStorage may be disabled in some contexts; ignore
    }
  };

  /** Slot click from PanelVisualization: empty → pre-fill form, breaker → edit.
   *  G34 fixup: when an empty TANDEM half is clicked, `tandemHalf` carries
   *  which half ('a' or 'b'); pre-fill poles=tandem + the half so the user
   *  doesn't have to re-pick those after tapping. */
  const handleSlotClick = useCallback(
    (slotN: number, breaker: Breaker | null, tandemHalf?: 'a' | 'b'): void => {
      if (breaker !== null) {
        setEditingId(breaker.id);
        // Scroll the row into view if it's been mounted
        setTimeout(() => {
          document.getElementById(`breaker-${breaker.id}`)?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }, 0);
        return;
      }
      // Empty slot: pre-fill the add-breaker form. Tandem half clicks
      // additionally pre-select poles=tandem + the specific half.
      setAddBreakerOpen(true);
      formApi.reset({
        slot: String(slotN),
        amperage: 20,
        poles: tandemHalf ? 'tandem' : 'single',
        label: '',
        slotPosition: slotN,
        tandemHalf: tandemHalf ?? null,
      });
      // Scroll the form into view + focus the label input
      setTimeout(() => {
        const labelInput = document.querySelector<HTMLInputElement>(
          'input[name="label"]'
        );
        labelInput?.focus();
        labelInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
    },
    // formApi is stable across renders so we omit it from deps to keep this
    // callback stable for PanelVisualization memo behavior. The same applies
    // to the document/setTimeout calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleConfigurePanel = async (): Promise<void> => {
    if (panel === null) return;
    const nextOrientation = await pick<'vertical' | 'horizontal'>({
      title: 'Panel orientation',
      message: 'Match the physical orientation of the panel.',
      options: [
        {
          value: 'vertical',
          label: 'Vertical',
          hint: 'Tall — slots stacked top-to-bottom',
        },
        {
          value: 'horizontal',
          label: 'Horizontal',
          hint: 'Wide — slots side-by-side',
        },
      ],
    });
    if (nextOrientation === null) return;
    const sc = await prompt({
      title: 'Slot count',
      label: 'Number of slots (1-200)',
      defaultValue: String(panel.slotCount),
      placeholder: '24',
    });
    if (sc === null) return;
    const n = Number.parseInt(sc.trim(), 10);
    if (!Number.isFinite(n) || n < 1 || n > 200) {
      toast.error('Slot count must be between 1 and 200.');
      return;
    }
    try {
      const updated = await updatePanel(panel.id, {
        orientation: nextOrientation,
        slotCount: n,
      });
      setPanel(updated);
      toast.success('Panel configured');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to configure panel.');
    }
  };

  const formApi = useForm<BreakerInput>({
    resolver: zodResolver(breakerInputSchema),
    defaultValues: {
      slot: '',
      amperage: 20,
      poles: 'single',
      label: '',
      slotPosition: null,
      // G37 cycle-68 — default to null (no protection) on create.
      protection: null,
    },
  });

  const refresh = useCallback(async () => {
    if (!panelId) return;
    setLoading(true);
    try {
      // G25 cycle-26 — bulk-load EVERYTHING in 3 parallel HTTP calls
      // (was 2 + N where N = breaker count, which on a 24-breaker panel
      // was 24 sequential listComponents calls eating 800ms+ on the dev
      // backend). One listComponents() returns every component across
      // every panel; we filter client-side to this panel's breakers.
      // Postgres at this scale (<10k components) handles a full table-scan
      // in <10ms — far cheaper than the N round-trips.
      const [p, b, allComponents, panels] = await Promise.all([
        getPanel(panelId),
        listBreakers(panelId),
        listComponents(),
        listPanels(),
      ]);
      setPanel(p);
      setBreakers(b);
      setAllPanels(panels);
      // G35 Part 1 (cycle-58) — cache the full component set so the
      // Impact modal can resolve direct + cascade hits without another
      // round-trip on click. listComponents was already on this critical
      // path; we just keep the unfiltered result around.
      setAllComponents(allComponents);

      const breakerIdSet = new Set(b.map((br) => br.id));
      const onThisPanel = allComponents.filter(
        (c) => c.breakerId !== null && breakerIdSet.has(c.breakerId)
      );
      const countMap: Record<string, number> = {};
      for (const br of b) countMap[br.id] = 0;
      for (const c of onThisPanel) {
        if (c.breakerId !== null) countMap[c.breakerId] = (countMap[c.breakerId] ?? 0) + 1;
      }
      setCounts(countMap);
      setPanelComponents(onThisPanel);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load panel.');
    } finally {
      setLoading(false);
    }
  }, [panelId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** G35 Part 1 (cycle-58) — lazy-load the impact data (full house
   *  breaker tree + floors) AFTER the critical-path refresh resolves.
   *  Kept off the critical path so the initial render isn't slowed by
   *  the N+1 round-trips inside listAllBreakersGrouped. If the user
   *  clicks Impact before this resolves, the modal still renders —
   *  cascade hits will populate once these arrive. */
  useEffect(() => {
    if (!panelId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [groups, fl] = await Promise.all([
          listAllBreakersGrouped(),
          listFloors(),
        ]);
        if (cancelled) return;
        setBreakersByPanel(
          new Map(groups.map((g) => [g.panel.id, g.breakers]))
        );
        setFloors(fl);
      } catch {
        // best-effort — Impact modal degrades to direct-only if this fails
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [panelId]);

  /** G36 cycle-61 — fetch latest BreakerTest per breaker after the main
   *  refresh resolves. Lazy + non-blocking so the initial paint of the
   *  panel + breakers + components isn't delayed by the audit fetch.
   *  Re-runs whenever `breakers` changes (new breaker, deleted breaker). */
  useEffect(() => {
    if (breakers.length === 0) {
      setLastTestByBreakerId(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const map = await latestBreakerTestsByIds(breakers.map((b) => b.id));
        if (!cancelled) setLastTestByBreakerId(map);
      } catch {
        // best-effort — the hint just hides if this fails (BreakerRow
        // treats undefined-in-map as "don't render the hint").
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [breakers]);

  /** G40 Part 1 cycle-66 — bulk-fetch service entries for every breaker on
   *  this panel in ONE round-trip (via ?parentIds=). Lazy + non-blocking,
   *  same pattern as the lastTest effect above. Groups the flat response
   *  back into a Map<breakerId, ServiceEntry[]> for the BreakerRow badge +
   *  ServiceLogModal consumers. Re-runs whenever `breakers` changes. */
  const refreshServiceEntries = useCallback(async (): Promise<void> => {
    if (breakers.length === 0) {
      setServiceEntriesByBreakerId(new Map());
      return;
    }
    try {
      const { data } = await listServiceEntries({
        parentType: 'breaker',
        parentIds: breakers.map((b) => b.id),
      });
      const byId = new Map<string, ServiceEntry[]>();
      for (const b of breakers) byId.set(b.id, []);
      for (const e of data) {
        const arr = byId.get(e.parentId);
        if (arr !== undefined) arr.push(e);
      }
      setServiceEntriesByBreakerId(byId);
    } catch {
      // best-effort — the badge just hides if this fails (BreakerRow
      // treats undefined `serviceLogCount` as "don't render the badge").
    }
  }, [breakers]);

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

  /** G39 cycle-56 — resolve parent breaker info lazily AFTER the main
   *  load completes, only if this panel has a parentBreakerId. Walks
   *  allPanels and fetches the owning panel's breakers to find the
   *  matching breaker. Cheap and non-blocking. */
  useEffect(() => {
    if (panel === null || panel.parentBreakerId === null) {
      setParentBreakerInfo(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        for (const candidate of allPanels) {
          if (candidate.id === panel.id) continue;
          const brs = await listBreakers(candidate.id);
          const match = brs.find((b) => b.id === panel.parentBreakerId);
          if (match) {
            if (!cancelled) {
              setParentBreakerInfo({ breaker: match, panelName: candidate.name });
            }
            return;
          }
        }
        if (!cancelled) setParentBreakerInfo(null);
      } catch {
        if (!cancelled) setParentBreakerInfo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [panel, allPanels]);

  // G23 — Hash-consumer: when the URL has #breaker-<id>, pulse-highlight the
  // controlling breaker. Prefers the panel-viz slot cell (slot-cell-<id>) when
  // in viz mode; falls back to the list-view row (breaker-<id>).
  //
  // If the user is in 'list' mode when a deep-link arrives, we temporarily flip
  // to 'viz' IN MEMORY ONLY (setView, NOT switchView) so the slot cell exists
  // in the DOM to be pulsed — the cycle-18-pinned localStorage preference is
  // NOT mutated, so the user's saved choice survives the next visit.
  // Exception: a breaker with slotPosition=null is not in the grid; for that
  // case we keep list view + pulse the row instead.
  //
  // Triggers: (a) breakers finish loading, (b) view changes, (c) hashchange —
  // (c) is load-bearing: arriving via a hash-only navigation from the same
  // panel path otherwise wouldn't fire this useEffect (no React state change).
  // Tracked via a `hashTick` counter bumped on each `hashchange`.
  const [hashTick, setHashTick] = useState(0);
  useEffect(() => {
    const onHashChange = (): void => setHashTick((n) => n + 1);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (loading || breakers.length === 0) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#breaker-')) return;
    const breakerId = hash.slice('#breaker-'.length);
    const breaker = breakers.find((b) => b.id === breakerId);
    if (breaker === undefined) return;

    const inGrid = breaker.slotPosition !== null;
    // If viz can render this breaker but we're currently in list, flip in-memory.
    if (inGrid && view !== 'viz') {
      setView('viz');
    } else if (!inGrid && view !== 'list') {
      // Breaker has no slot position → can't be highlighted in viz; fall back to list.
      setView('list');
    }

    // Defer to next frame so the new view's DOM is mounted before we query for it.
    const raf = window.requestAnimationFrame(() => {
      const slotEl = inGrid ? document.getElementById(`slot-cell-${breakerId}`) : null;
      const rowEl = document.getElementById(`breaker-${breakerId}`);
      const target = slotEl ?? rowEl;
      if (target === null) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.setAttribute('data-highlight', 'true');
      window.setTimeout(() => target.removeAttribute('data-highlight'), 1500);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [loading, breakers, view, hashTick]);

  const handleCreate = async (input: BreakerInput): Promise<void> => {
    try {
      await createBreaker(panelId, input);
      formApi.reset({
        slot: '',
        amperage: 20,
        poles: 'single',
        label: '',
        slotPosition: null,
      });
      toast.success('Breaker added');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add breaker.');
    }
  };

  const handleUpdate = async (id: string, patch: Partial<BreakerInput>): Promise<void> => {
    try {
      await updateBreaker(id, patch);
      setEditingId(null);
      toast.success('Breaker saved');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save breaker.');
    }
  };

  // G42(c) cycle-47 — one-tap delete + 30s undo. Server DELETE is held
  // by useUndoableDelete. Label format follows the cycle-42 G34 tandem
  // convention: "Slot 6a: Kitchen lights" / "Slot 6: Kitchen lights".
  const handleDelete = (id: string): void => {
    const target = breakers.find((b) => b.id === id);
    if (!target) return;
    const prevBreakers = breakers;
    const prevCounts = counts;
    const label = `Slot ${target.slot}${target.tandemHalf ?? ''}: ${target.label}`;
    deleteWithUndo({
      id,
      resourceType: 'breaker',
      label,
      removeOptimistically: () => {
        setBreakers((cur) => cur.filter((b) => b.id !== id));
        // Drop the count entry so the viz updates with the row gone.
        setCounts((cur) => {
          const next = { ...cur };
          delete next[id];
          return next;
        });
        // If the user was editing this breaker, exit edit mode.
        if (editingId === id) setEditingId(null);
      },
      restore: () => {
        setBreakers(prevBreakers);
        setCounts(prevCounts);
      },
      commit: async () => {
        await deleteBreaker(id);
      },
      onCommitted: () => {
        // Refresh to pick up any side-effects (e.g. components that
        // became unwired by the server's ON DELETE SET NULL).
        void refresh();
      },
    });
  };

  const handleDeletePanel = async (): Promise<void> => {
    if (!panel) return;
    const ok = await confirm({
      title: 'Delete panel?',
      message: `"${panel.name}" and all its breakers will be permanently removed. Any components wired to those breakers will become unwired. This cannot be undone.`,
      confirmLabel: 'Delete panel',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      await deletePanel(panel.id);
      window.location.assign('/');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete panel.');
    }
  };

  /** G25 cycle-24 — group components by breaker id for the
   *  Components-on-panel section. Breakers without components are kept
   *  (shown as "No components yet" so users see the wiring slot). */
  const breakerGroups = breakers.map((b) => ({
    breaker: b,
    components: panelComponents.filter((c) => c.breakerId === b.id),
  }));
  const totalWiredComponents = panelComponents.length;

  /** G39 cycle-56 — Map from this panel's feeder breaker id → the subpanel
   *  it feeds. Used by PanelVisualization to render a "→ Subpanel" chip on
   *  the feeder slot. Built from allPanels filtered by parentBreakerId
   *  pointing at any of THIS panel's breakers. */
  const subpanelsByFeederBreakerId = useMemo(() => {
    const breakerIdSet = new Set(breakers.map((b) => b.id));
    const map = new Map<string, Panel>();
    for (const p of allPanels) {
      if (p.parentBreakerId !== null && breakerIdSet.has(p.parentBreakerId)) {
        map.set(p.parentBreakerId, p);
      }
    }
    return map;
  }, [allPanels, breakers]);

  /** G39 cycle-56 — reverse lookup: for each of THIS panel's breakers,
   *  which subpanel does it feed (if any)? Used to seed the "Feeds
   *  subpanel" picker in BreakerForm when editing. */
  const subpanelByBreakerId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of allPanels) {
      if (p.parentBreakerId !== null) {
        map.set(p.parentBreakerId, p.id);
      }
    }
    return map;
  }, [allPanels]);

  /** G39 cycle-56 — "Fed by" info: when THIS panel is a subpanel, the
   *  parent breaker info is loaded lazily via the effect above. */
  const parentInfo = useMemo(() => {
    if (panel === null || panel.parentBreakerId === null) return null;
    if (parentBreakerInfo === null) {
      return { breakerId: panel.parentBreakerId, resolved: null };
    }
    return {
      breakerId: panel.parentBreakerId,
      resolved: {
        panelName: parentBreakerInfo.panelName,
        slot: parentBreakerInfo.breaker.slot,
        label: parentBreakerInfo.breaker.label,
        tandemHalf: parentBreakerInfo.breaker.tandemHalf,
      },
    };
  }, [panel, parentBreakerInfo]);

  /** G39 cycle-56 — write handler for the "Feeds subpanel" picker. The
   *  field lives on the PANEL, not the breaker. So picking a panel means
   *  PATCHing THAT panel's parent_breaker_id = this breaker's id.
   *  Picking "(no subpanel)" means: find the panel currently pointing at
   *  this breaker, PATCH it to null. */
  const handleChangeFeedsSubpanel = useCallback(
    async (breakerId: string, subpanelId: string | null): Promise<void> => {
      try {
        if (subpanelId === null) {
          // Detach: find current subpanel for this breaker, set its parent to null.
          const current = subpanelByBreakerId.get(breakerId);
          if (current === undefined) return; // nothing wired
          await updatePanel(current, { parentBreakerId: null });
          toast.success('Subpanel unlinked');
        } else {
          await updatePanel(subpanelId, { parentBreakerId: breakerId });
          toast.success('Subpanel linked');
        }
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to update subpanel link.');
      }
    },
    [subpanelByBreakerId, refresh]
  );

  /** G39 cycle-56 — "Fed by" picker on the panel itself. Cascading
   *  picker: first pick the parent panel, then pick which breaker on it.
   *  Set null to detach. */
  const handleChangeFedBy = useCallback(async (): Promise<void> => {
    if (panel === null) return;
    // Exclude self + descendants from parent options. A descendant would
    // create a cycle. Simple walk: build the set of descendants by
    // iteratively expanding the set of panels fed by any of this panel's
    // breakers, then their breakers, etc.
    const descendantIds = new Set<string>();
    descendantIds.add(panel.id);
    // We don't have a cross-panel breaker map here; the server is the
    // final cycle-check guard. We can at least exclude self + any panel
    // whose parent_breaker_id points to a breaker on THIS panel.
    const breakerIdSet = new Set(breakers.map((b) => b.id));
    for (const p of allPanels) {
      if (p.parentBreakerId !== null && breakerIdSet.has(p.parentBreakerId)) {
        descendantIds.add(p.id);
      }
    }
    const candidateParents = allPanels.filter((p) => !descendantIds.has(p.id));

    type ParentChoice = string | '__detach__';
    const choice = await pick<ParentChoice>({
      title: 'Fed by',
      message:
        'Pick the parent panel that feeds this one via a breaker (typical garage/basement subpanel).',
      options: [
        ...(panel.parentBreakerId !== null
          ? [
              {
                value: '__detach__' as ParentChoice,
                label: 'Detach (top-level panel)',
                hint: 'This panel is not fed by another.',
              },
            ]
          : []),
        ...candidateParents.map((p) => ({
          value: p.id as ParentChoice,
          label: p.name,
          hint: p.parentBreakerId === null ? 'Top-level panel' : 'Subpanel',
        })),
      ],
      emptyMessage: 'No other panels to choose from.',
    });
    if (choice === null) return;
    if (choice === '__detach__') {
      try {
        await updatePanel(panel.id, { parentBreakerId: null });
        toast.success('Detached');
        await refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to detach.');
      }
      return;
    }

    // Step 2: pick a breaker on the chosen parent panel.
    const parentBreakers = await listBreakers(choice);
    if (parentBreakers.length === 0) {
      toast.error('That panel has no breakers — add one first.');
      return;
    }
    const breakerChoice = await pick<string>({
      title: 'Pick the feeder breaker',
      message: 'Which breaker on the parent panel feeds this subpanel?',
      options: parentBreakers
        // Tandems can't be feeders per the UX decision.
        .filter((b) => b.poles !== 'tandem')
        .map((b) => ({
          value: b.id,
          label: `Slot ${b.slot}: ${b.label}`,
          hint: `${b.amperage}A · ${b.poles === 'double' ? 'Double-pole' : 'Single-pole'}`,
        })),
    });
    if (breakerChoice === null) return;
    try {
      await updatePanel(panel.id, { parentBreakerId: breakerChoice });
      toast.success('Subpanel linked');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to link subpanel.');
    }
  }, [panel, breakers, allPanels, pick, refresh]);

  /** G25 cycle-29 — Add-a-breaker form starts collapsed unless the panel
   *  has no breakers (in which case it auto-expands as the empty-state
   *  guidance). Hidden behind a + button thereafter to free 400px+ of
   *  vertical real-estate at the top of every visit. */
  const [addBreakerOpen, setAddBreakerOpen] = useState(false);
  useEffect(() => {
    if (!loading && breakers.length === 0) setAddBreakerOpen(true);
  }, [loading, breakers.length]);

  /** G25 cycle-24 — clicking a component row sets the URL hash so the
   *  cycle-22 G23 hash consumer pulse-highlights the matching slot
   *  in-page. NO navigation — same path, hash-only change. */
  const handleHighlightBreaker = (breakerId: string): void => {
    const next = `#breaker-${breakerId}`;
    if (window.location.hash === next) {
      // Same target — replace to re-trigger the hashchange listener.
      window.history.replaceState(null, '', window.location.pathname);
    }
    window.location.hash = next;
  };

  /** G35 Part 1 (cycle-58) — compute Impact items lazily when the modal
   *  is open. Pure read-only — no mutation of the off-state. */
  const impactItems = useMemo(() => {
    if (impactBreakerId === null) return [];
    return computeImpact(
      impactBreakerId,
      allComponents,
      allPanels,
      breakersByPanel
    );
  }, [impactBreakerId, allComponents, allPanels, breakersByPanel]);

  /** G35 Part 1 (cycle-58) — floor lookup by id for the Impact modal. */
  const floorById = useMemo(() => {
    const map = new Map<string, Floor>();
    for (const f of floors) map.set(f.id, f);
    return map;
  }, [floors]);

  /** G35 Part 1 (cycle-58) — display label for the modal title. Reuses
   *  the cycle-42 G34 tandem-half convention ("Slot 6a" / "Slot 6"). */
  const impactBreakerLabel = useMemo(() => {
    if (impactBreakerId === null) return '';
    const b = breakers.find((br) => br.id === impactBreakerId);
    if (!b) return 'breaker';
    const half = b.poles === 'tandem' && b.tandemHalf !== null ? b.tandemHalf : '';
    return `Slot ${b.slot}${half}`;
  }, [impactBreakerId, breakers]);

  /** G40 Part 1 cycle-66 — display label + entries for the ServiceLogModal.
   *  Uses the cycle-42 tandem convention ("Slot 6a: Kitchen lights") so
   *  the user can tell which breaker they're logging against. */
  const serviceLogBreaker = useMemo(
    () =>
      serviceLogBreakerId === null
        ? null
        : breakers.find((b) => b.id === serviceLogBreakerId) ?? null,
    [serviceLogBreakerId, breakers]
  );
  const serviceLogLabel = useMemo(() => {
    if (serviceLogBreaker === null) return '';
    const half =
      serviceLogBreaker.poles === 'tandem' &&
      serviceLogBreaker.tandemHalf !== null
        ? serviceLogBreaker.tandemHalf
        : '';
    return `Slot ${serviceLogBreaker.slot}${half}: ${serviceLogBreaker.label}`;
  }, [serviceLogBreaker]);
  const serviceLogEntries =
    serviceLogBreakerId === null
      ? []
      : serviceEntriesByBreakerId.get(serviceLogBreakerId) ?? [];

  const handleAddServiceEntry = useCallback(
    async (input: { note: string; occurredAt: number }): Promise<void> => {
      if (serviceLogBreakerId === null) return;
      try {
        await createBreakerServiceEntry(serviceLogBreakerId, input);
        toast.success('Service entry added');
        await refreshServiceEntries();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : 'Failed to add service entry.'
        );
        throw e;
      }
    },
    [serviceLogBreakerId, refreshServiceEntries]
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

  return (
    <>
      <ScreenHeader
        title={panel?.name ?? (loading ? 'Loading…' : 'Panel')}
        back="/"
      >
        {panel &&
          (() => {
            // Refactor 2026-05 — point at the floor's canvas (Map tab) when
            // a linked floor exists; fall back to /map (floor list) so the
            // user always lands on a useful map surface. Replaces the old
            // panel-scoped /panels/:id/map route.
            const linked = floors.find((f) => f.panelId === panel.id);
            const href = linked ? `/floors/${linked.id}/edit` : '/map';
            return (
              <Link
                href={href}
                className="link-action link-action--header"
                aria-label="Open on map"
                data-testid="panel-detail-open-on-map"
              >
                <MapIcon size={18} strokeWidth={2.25} aria-hidden="true" />
                <span>Open on map</span>
              </Link>
            );
          })()}
      </ScreenHeader>

      {/* G25 cycle-29 — Collapsible Add-a-breaker form. Collapsed by
         default once the panel has any breakers, so this 400px+ form
         doesn't dominate every revisit. Auto-opens on empty-panel state
         to guide first-time setup. */}
      {addBreakerOpen ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a breaker</CardTitle>
            {breakers.length > 0 && (
              <CardActions>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAddBreakerOpen(false)}
                  aria-label="Hide add-breaker form"
                  leadingIcon={<ChevronUp size={16} strokeWidth={2.25} />}
                >
                  Done
                </Button>
              </CardActions>
            )}
          </CardHeader>
          <BreakerForm
            form={formApi}
            onSubmit={handleCreate}
            submitLabel="Add breaker"
            slotCount={panel?.slotCount ?? 24}
            existingBreakers={breakers}
          />
        </Card>
      ) : (
        !loading && (
          <Button
            variant="secondary"
            block
            leadingIcon={<Plus size={18} strokeWidth={2.25} />}
            onClick={() => setAddBreakerOpen(true)}
            data-testid="open-add-breaker"
          >
            Add a breaker
          </Button>
        )
      )}

      {/* G25 cycle-24 — split layout: components-on-panel + panel-viz side-
         by-side at ≥960px, stacked below. Click a component on the left,
         see its slot pulse on the right — no navigation away from the page. */}
      <div className="panel-detail__split">

      <section aria-labelledby="components-on-panel-heading" className="section panel-detail__left">
        <h2 id="components-on-panel-heading" className="section-title">
          Components on this panel
          {totalWiredComponents > 0 && (
            <span className="muted"> · {totalWiredComponents}</span>
          )}
        </h2>
        {loading ? (
          <Skeleton variant="row" count={4} aria-label="Loading components" />
        ) : totalWiredComponents === 0 ? (
          <EmptyState
            illustration={<NoComponents />}
            title="No components wired yet"
            description="Add components from the Library tab and assign them to a breaker — they'll appear here grouped by breaker."
            action={
              <Link href="/library">
                <Button variant="secondary">Go to Library</Button>
              </Link>
            }
          />
        ) : (
          <ul className="components-on-panel" data-testid="components-on-panel">
            {breakerGroups
              .filter((g) => g.components.length > 0)
              .map(({ breaker: b, components }) => (
                <li key={b.id} className="components-on-panel__group">
                  <button
                    type="button"
                    className="components-on-panel__group-header"
                    onClick={() => handleHighlightBreaker(b.id)}
                    aria-label={`Highlight slot ${b.slot} on the panel`}
                  >
                    <span className="components-on-panel__slot">
                      Slot {b.slot}
                    </span>
                    <span className="components-on-panel__label">
                      {b.label}
                    </span>
                    <span className="components-on-panel__amp">
                      {b.amperage}A
                    </span>
                  </button>
                  <ul className="components-on-panel__items">
                    {components.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="components-on-panel__item"
                          onClick={() => handleHighlightBreaker(b.id)}
                          data-testid="components-on-panel-item"
                          data-component-id={c.id}
                          data-breaker-id={b.id}
                        >
                          <span className="components-on-panel__icon" aria-hidden="true">
                            <ComponentTypeIcon type={c.type} />
                          </span>
                          <span className="components-on-panel__name">{c.name}</span>
                          {c.room !== null && (
                            <span className="components-on-panel__room muted">
                              · {c.room}
                            </span>
                          )}
                          {c.protection !== null && (
                            <ProtectionBadge kind={c.protection} />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="breakers-heading" className="section panel-detail__right">
        <h2 id="breakers-heading" className="section-title">
          Breakers
        </h2>
        {/* G18 view toggle: Visualization (default) | List */}
        {!loading && panel !== null && (
          <div className="panel-view-toggle" role="tablist" aria-label="Panel view">
            <button
              type="button"
              role="tab"
              aria-pressed={view === 'viz'}
              onClick={() => switchView('viz')}
            >
              Visualization
            </button>
            <button
              type="button"
              role="tab"
              aria-pressed={view === 'list'}
              onClick={() => switchView('list')}
            >
              List
            </button>
          </div>
        )}
        {loading ? (
          <Skeleton variant="row" count={4} aria-label="Loading breakers" />
        ) : breakers.length === 0 ? (
          <EmptyState
            illustration={<NoBreakers />}
            title="No breakers yet"
            description="Add your first breaker above to start mapping circuits."
          />
        ) : view === 'viz' && panel !== null ? (
          <PanelVisualization
            panel={panel}
            breakers={breakers}
            onSlotClick={handleSlotClick}
            subpanelsByFeederBreakerId={subpanelsByFeederBreakerId}
          />
        ) : (
          <ul className="breaker-list">
            {breakers.map((b) => (
              <BreakerWithComponents
                key={b.id}
                breaker={b}
                isEditing={editingId === b.id}
                onStartEdit={() => setEditingId(b.id)}
                onCancelEdit={() => setEditingId(null)}
                onSave={(patch) => handleUpdate(b.id, patch)}
                onDelete={async () => handleDelete(b.id)}
                componentCount={counts[b.id] ?? 0}
                slotCount={panel?.slotCount ?? 24}
                siblings={breakers}
                allPanels={allPanels}
                currentSubpanelId={subpanelByBreakerId.get(b.id) ?? null}
                onChangeFeedsSubpanel={(subId) =>
                  handleChangeFeedsSubpanel(b.id, subId)
                }
                onShowImpact={() => setImpactBreakerId(b.id)}
                lastTest={
                  lastTestByBreakerId.has(b.id)
                    ? lastTestByBreakerId.get(b.id) ?? null
                    : undefined
                }
                serviceLogCount={
                  serviceEntriesByBreakerId.has(b.id)
                    ? serviceEntriesByBreakerId.get(b.id)?.length ?? 0
                    : undefined
                }
                onShowServiceLog={() => setServiceLogBreakerId(b.id)}
              />
            ))}
          </ul>
        )}
      </section>

      </div>{/* /panel-detail__split */}

      {/* G39 cycle-56 / cycle-57 — "Fed by" card. Renders ONLY when this
         panel HAS a parent (subpanel). Main / root panels show NOTHING
         here (per user feedback: the "Set parent" CTA on a root panel was
         misleading — the main service panel isn't fed by another panel,
         and constantly nagging the user to "set parent" implied otherwise).
         The opt-in path for marking a panel as a subpanel lives in the
         footer "Mark as subpanel" link below. */}
      {panel && !loading && parentInfo !== null && (
        <Card>
          <div className="panel-detail__fedby">
            <div className="panel-detail__fedby-info">
              <span
                className="panel-detail__fedby-icon"
                aria-hidden="true"
              >
                <ArrowUpFromLine size={18} strokeWidth={2.25} />
              </span>
              <div>
                <p className="panel-detail__fedby-label">Fed by</p>
                <p
                  className="panel-detail__fedby-value"
                  data-testid="panel-fed-by-value"
                >
                  {parentInfo.resolved === null
                    ? 'Fed by another panel'
                    : (() => {
                        const r = parentInfo.resolved;
                        const slotLabel = `${r.slot}${r.tandemHalf ?? ''}`;
                        return `${r.panelName} · Slot ${slotLabel} (${r.label})`;
                      })()}
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void handleChangeFedBy();
              }}
              data-testid="panel-fed-by-change"
            >
              Change
            </Button>
          </div>
        </Card>
      )}

      {/* G25 cycle-24 — footer chrome: panel-config + Test-mode (moved
         from header per user feedback "Test mode looks useless" — now
         less prominent + carries an explainer line so first-time users
         know what it does) + delete-panel. */}
      {panel && (
        <section className="section panel-detail__footer">
          <div className="panel-detail__footer-row">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void handleConfigurePanel();
              }}
            >
              Configure panel ({panel.orientation}, {panel.slotCount} slots)
            </Button>
            <Link
              href={`/test/${panel.id}`}
              className="link-action link-action--footer"
              aria-label="Open walk-through breaker-test mode"
            >
              <Zap size={16} strokeWidth={2.25} aria-hidden="true" />
              <span className="link-action__label">
                <span>Walk-through</span>
                <span className="link-action__hint">Flip breakers, tag what loses power</span>
              </span>
            </Link>
            <Link
              href={`/panels/${panel.id}/print`}
              className="link-action link-action--footer"
              aria-label="Open printable breaker diagram"
            >
              <Printer size={16} strokeWidth={2.25} aria-hidden="true" />
              <span className="link-action__label">
                <span>Print diagram</span>
                <span className="link-action__hint">For taping inside your panel door</span>
              </span>
            </Link>
          </div>
          {/* G39 cycle-57 — quiet opt-in to mark a panel as a subpanel.
             Only renders when this panel currently HAS no parent (root /
             main-service-style panel). Prevents the cycle-56 "Fed by" card
             from nagging users whose root panel isn't fed by another. */}
          {parentInfo === null && (
            <p className="panel-detail__footer-aside">
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  void handleChangeFedBy();
                }}
                data-testid="panel-mark-as-subpanel"
              >
                Is this fed by another panel? Mark as subpanel…
              </button>
            </p>
          )}
          <div className="panel-detail__move">
            <MoveToBuildingButton kind="panel" id={panel.id} name={panel.name} />
          </div>
          <div className="section--danger">
            <Button variant="danger" block onClick={handleDeletePanel}>
              Delete this panel
            </Button>
          </div>
        </section>
      )}
      {modalNode}
      {impactBreakerId !== null && (
        <ImpactModal
          open
          breakerLabel={impactBreakerLabel}
          items={impactItems}
          floorById={floorById}
          onClose={() => setImpactBreakerId(null)}
        />
      )}
      {serviceLogBreakerId !== null && (
        <ServiceLogModal
          open
          parentLabel={serviceLogLabel}
          parentType="breaker"
          entries={serviceLogEntries}
          onAddEntry={handleAddServiceEntry}
          onDeleteEntry={handleDeleteServiceEntry}
          onClose={() => setServiceLogBreakerId(null)}
        />
      )}
    </>
  );
};
