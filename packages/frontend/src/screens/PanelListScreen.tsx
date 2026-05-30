import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { Activity, CornerDownRight, Plus, ShieldAlert } from 'lucide-react';
import type { Breaker, Panel } from '@he/shared';
import {
  ApiHttpError,
  createBreakerTest,
  createPanel,
  latestBreakerTestsByIds,
  listAllBreakersGrouped,
  listPanels,
} from '../api.js';
import { suffixDuplicate } from '../lib/duplicateName.js';
import { startOfMonthEpoch } from '../lib/datetime.js';
import { filterUntestedProtected } from '../lib/protection.js';
import { useModal } from '../hooks/useModal.js';
import {
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  NoPanels,
  ScreenHeader,
  Skeleton,
  toast,
} from '../ui/index.js';

/** G39 cycle-56 — node in the hierarchical panel tree.
 *  Children are panels whose parentBreakerId belongs to one of this panel's
 *  breakers. */
type PanelTreeNode = {
  panel: Panel;
  /** Resolved feeder breaker on the PARENT panel (when this is a subpanel) —
   *  used for the "Slot X / Label" hint next to the row. null at root. */
  feederHint: string | null;
  children: PanelTreeNode[];
};

export const PanelListScreen = (): JSX.Element => {
  const [panels, setPanels] = useState<Panel[]>([]);
  /** G39 cycle-56 — global breakerId → {slot, label, tandemHalf, panelId}
   *  index for resolving subpanel feeder labels ("Slot 6: Garage 60A")
   *  AND determining which panel owns a given feeder breaker (so we can
   *  nest the subpanel under the correct parent in the tree view). */
  const [breakerIndexWithPanel, setBreakerIndexWithPanel] = useState<
    Map<
      string,
      { slot: string; label: string; tandemHalf: string | null; panelId: string }
    >
  >(new Map());
  /** G37 Part 2 cycle-69 — every breaker across all panels carrying
   *  `protection !== null`. Used to compute the "untested this month"
   *  aggregate card at the top of the screen. */
  const [protectedBreakers, setProtectedBreakers] = useState<Breaker[]>([]);
  /** G37 Part 2 cycle-69 — last breaker_test per protected breaker.
   *  null when never tested. */
  const [latestTestByBreaker, setLatestTestByBreaker] = useState<
    Map<string, number | null>
  >(new Map());
  /** Cycle-70 polish-pass-2 P2 #12 — count of breakers on each panel.
   *  Drives the "N of M slots used" row meta, filling the previously-empty
   *  horizontal space on desktop with information already at hand. */
  const [breakerCountByPanel, setBreakerCountByPanel] = useState<
    Map<string, number>
  >(new Map());
  /** G37 Part 2 cycle-69 — in-flight flag for the "Test all now" fan-out
   *  so the button can disable + show progress text. */
  const [testingAll, setTestingAll] = useState(false);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Cycle-62 — "Add a panel" is now a header CTA that opens a base-Modal
  // (NOT useModal()) wrapper. The base Modal is a separate render surface
  // from useModal's singleton, so the 409-retry prompt below doesn't
  // collide with the open-add wrapper (which would drop the typed name).
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const { confirm, prompt, modalNode } = useModal();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [allPanels, grouped] = await Promise.all([
        listPanels(),
        listAllBreakersGrouped(),
      ]);
      setPanels(allPanels);
      const idx = new Map<
        string,
        {
          slot: string;
          label: string;
          tandemHalf: string | null;
          panelId: string;
        }
      >();
      const protBreakers: Breaker[] = [];
      for (const g of grouped) {
        for (const br of g.breakers) {
          idx.set(br.id, {
            slot: br.slot,
            label: br.label,
            tandemHalf: br.tandemHalf,
            panelId: g.panel.id,
          });
          if (br.protection !== null) protBreakers.push(br);
        }
      }
      setBreakerIndexWithPanel(idx);
      setProtectedBreakers(protBreakers);
      // Cycle-70 polish-pass-2 P2 #12 — derive per-panel breaker counts
      // from the already-loaded grouped list. Used to enrich the row card
      // with a "N of M slots used" hint that fills the previously-empty
      // horizontal space on desktop without an extra API round-trip.
      const counts = new Map<string, number>();
      for (const g of grouped) counts.set(g.panel.id, g.breakers.length);
      setBreakerCountByPanel(counts);

      // G37 Part 2 cycle-69 — load latest breaker_test for every
      // protected breaker so we can derive "untested this month" below.
      // Reuses cycle-61's `latestBreakerTestsByIds` (one round-trip per
      // breaker, acceptable for typical residential panel counts).
      if (protBreakers.length > 0) {
        const tests = await latestBreakerTestsByIds(
          protBreakers.map((b) => b.id)
        );
        const m = new Map<string, number | null>();
        for (const [id, t] of tests) {
          m.set(id, t === null ? null : t.testedAt);
        }
        setLatestTestByBreaker(m);
      } else {
        setLatestTestByBreaker(new Map());
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load panels.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** G37 Part 2 cycle-69 — start of current calendar month, epoch ms.
   *  Recomputed each render (cheap) so the card naturally rolls over
   *  on month boundary without manual refresh. A breaker is "untested
   *  this month" when its latest breaker_test is null OR testedAt is
   *  strictly less than this value. */
  const monthStart = useMemo(() => startOfMonthEpoch(), []);

  /** G37 Part 2 cycle-69 — subset of protectedBreakers whose latest
   *  test is null OR before monthStart. Hidden card when length === 0
   *  (per spec: "no chrome eaten when nothing to do").
   *
   *  G45 (2026-05) — the filter logic now lives in the pure
   *  `lib/protection.ts` (single source of truth, unit-tested, shared
   *  with the status dashboard). Behavior is byte-identical. */
  const untestedProtected = useMemo<Breaker[]>(
    () =>
      filterUntestedProtected(protectedBreakers, latestTestByBreaker, monthStart),
    [protectedBreakers, latestTestByBreaker, monthStart]
  );

  /** G37 Part 2 cycle-69 — one-tap "Test all now" fan-out. Confirms,
   *  then POSTs one breaker_tests row per untested protected breaker
   *  with outcome='monthly self-test' + testedAt=Date.now(). Uses
   *  Promise.allSettled so partial-fail surfaces as a count without
   *  losing the succeeded writes. Refresh after — the card auto-hides
   *  when all are now this-month-tested. */
  const handleTestAllProtected = useCallback(async () => {
    if (untestedProtected.length === 0) return;
    const n = untestedProtected.length;
    const ok = await confirm({
      title: `Mark ${n} breaker${n === 1 ? '' : 's'} as tested today?`,
      message:
        n === 1
          ? 'A single monthly self-test entry will be recorded for the GFCI/AFCI device.'
          : `${n} monthly self-test entries will be recorded — one per protected device.`,
      confirmLabel: 'Mark tested',
    });
    if (!ok) return;
    setTestingAll(true);
    try {
      const now = Date.now();
      const results = await Promise.allSettled(
        untestedProtected.map((b) =>
          createBreakerTest(b.id, {
            outcome: 'monthly self-test',
            testedAt: now,
            notes: 'Bulk-marked from monthly aggregate card',
          })
        )
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      const succeeded = results.length - failed;
      if (failed === 0) {
        toast.success(
          succeeded === 1
            ? 'Marked 1 protected breaker as tested.'
            : `Marked ${succeeded} protected breakers as tested.`
        );
      } else if (succeeded === 0) {
        toast.error(
          n === 1
            ? 'Failed to record the test entry.'
            : `Failed to record ${failed} test entries.`
        );
      } else {
        toast.error(
          `Recorded ${succeeded} of ${n} — ${failed} failed.`
        );
      }
      await refresh();
    } finally {
      setTestingAll(false);
    }
  }, [confirm, refresh, untestedProtected]);

  /**
   * G42(a) cycle-49 — create-with-409-retry.
   * Backend rejects duplicates with 409; client offers a suffixed candidate
   * in a re-prompt modal. Recursive to keep retrying if user accepts the
   * suggestion but it ALSO collides (race / multiple in-flight).
   */
  const attemptCreate = useCallback(
    async (candidate: string): Promise<boolean> => {
      try {
        await createPanel(candidate);
        toast.success('Panel created');
        // Cycle-62 — close the Add-panel modal on success.
        setAddPanelOpen(false);
        await refresh();
        return true;
      } catch (err) {
        if (err instanceof ApiHttpError && err.status === 409) {
          const suggested = suffixDuplicate(candidate);
          toast.error(`Name "${candidate}" is taken — try "${suggested}"?`);
          const retry = await prompt({
            title: 'Pick a different name',
            label: 'Panel name',
            defaultValue: suggested,
          });
          if (retry === null) return false;
          return attemptCreate(retry);
        }
        toast.error(err instanceof Error ? err.message : 'Failed to create panel.');
        return false;
      }
    },
    [prompt, refresh]
  );

  /** G39 cycle-56 — build the hierarchical tree from the flat panels list.
   *  Root = panels with parentBreakerId === null OR whose parent breaker is
   *  orphaned (defensive: a panel pointing at a deleted breaker shouldn't
   *  vanish from the list). Each panel's children are nested under it. */
  const tree = useMemo<PanelTreeNode[]>(() => {
    const childrenByParent = new Map<string, PanelTreeNode[]>();
    const allNodes = new Map<string, PanelTreeNode>();
    for (const p of panels) {
      allNodes.set(p.id, {
        panel: p,
        feederHint: null,
        children: [],
      });
    }
    const breakerPanelMap = breakerIndexWithPanel;

    for (const p of panels) {
      if (p.parentBreakerId === null) continue;
      const info = breakerPanelMap.get(p.parentBreakerId);
      if (!info) continue; // orphan: render at root
      const parentPanelId = info.panelId;
      const node = allNodes.get(p.id);
      if (!node) continue;
      const feederSuffix = `${info.slot}${info.tandemHalf ?? ''}`;
      node.feederHint = `Slot ${feederSuffix}: ${info.label}`;
      const arr = childrenByParent.get(parentPanelId);
      if (arr) arr.push(node);
      else childrenByParent.set(parentPanelId, [node]);
    }

    // Sort children by their panel.createdAt ASC (matches the original
    // flat order).
    for (const arr of childrenByParent.values()) {
      arr.sort((a, b) => a.panel.createdAt - b.panel.createdAt);
    }

    // Attach children to their parents.
    for (const [parentId, children] of childrenByParent) {
      const parentNode = allNodes.get(parentId);
      if (parentNode) parentNode.children = children;
    }

    // Roots = panels with no parent OR with an orphaned parent.
    const roots: PanelTreeNode[] = [];
    for (const p of panels) {
      const isRoot =
        p.parentBreakerId === null ||
        !breakerPanelMap.has(p.parentBreakerId);
      if (isRoot) {
        const node = allNodes.get(p.id);
        if (node) roots.push(node);
      }
    }
    roots.sort((a, b) => a.panel.createdAt - b.panel.createdAt);
    return roots;
  }, [panels, breakerIndexWithPanel]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) return;

    setSubmitting(true);
    try {
      const ok = await attemptCreate(trimmed);
      if (ok) setName('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <ScreenHeader title="House Electricals" subtitle="Map your electrical panels">
        {/* G45 — Status dashboard entry point. AppShell-wrapped /dashboard
            route (NOT a 5th bottom-tab). */}
        <Link
          href="/dashboard"
          className="screen-header__link"
          data-testid="open-dashboard"
          aria-label="Open status dashboard"
        >
          <Activity size={16} strokeWidth={2} />
          Status
        </Link>
        <Button
          variant="primary"
          size="sm"
          leadingIcon={<Plus size={16} strokeWidth={2.25} />}
          onClick={() => setAddPanelOpen(true)}
          data-testid="open-add-panel"
          aria-label="Add a panel"
        >
          Add panel
        </Button>
      </ScreenHeader>

      {/* Cycle-62 — Add-a-panel lives in a Modal triggered by the
          ScreenHeader CTA. Was an always-visible Card eating ~half the
          screen on what's primarily a list view. Cancel + Close (X)
          dismiss; success auto-closes via attemptCreate.

          Wrapper is the BASE Modal (not useModal()) so the 409-retry
          PromptModal (singleton-replaced by useModal) doesn't tear this
          wrapper down mid-create and drop the user's typed name. */}
      <Modal
        open={addPanelOpen}
        onClose={() => setAddPanelOpen(false)}
        title="Add a panel"
        testId="add-panel-modal"
        presentation="sheet"
      >
        <form onSubmit={handleSubmit}>
          <Input
            label={null}
            aria-label="Panel name"
            placeholder="e.g. Main panel"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting}
            autoComplete="off"
            inputMode="text"
          />
          {/* Cycle-65 P1 — Cancel + Create footer to match the Add Component
              modal pattern (sibling cycle-62 consumers were inconsistent —
              Add Component had Cancel, Add Panel/Floor did not). */}
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAddPanelOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              busy={submitting}
              disabled={submitting || name.trim().length === 0}
              leadingIcon={<Plus size={18} strokeWidth={2.25} />}
            >
              {submitting ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* G37 Part 2 cycle-69 — monthly aggregate card. Counts protected
          (GFCI/AFCI/dual) breakers across ALL panels whose latest
          breaker_test is null OR before the start of the current month.
          Hidden entirely when count === 0 (no chrome eaten when nothing
          to do). One-tap "Test all now" fans out N POSTs via
          Promise.allSettled and refreshes — card auto-hides when all
          are this-month-tested. */}
      {!loading && untestedProtected.length > 0 && (
        <Card
          className="protection-aggregate-card"
          data-testid="panel-list-protection-aggregate-card"
        >
          <div className="protection-aggregate-card__inner">
            <span
              className="protection-aggregate-card__icon"
              aria-hidden="true"
            >
              <ShieldAlert size={22} strokeWidth={2} />
            </span>
            <div className="protection-aggregate-card__body">
              <p className="protection-aggregate-card__title">
                {untestedProtected.length === 1
                  ? '1 GFCI/AFCI device untested this month'
                  : `${untestedProtected.length} GFCI/AFCI devices untested this month`}
              </p>
              <p className="protection-aggregate-card__subtitle">
                NEC recommends monthly testing of GFCI &amp; AFCI
                protection devices.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleTestAllProtected()}
              disabled={testingAll}
              data-testid="test-all-protected"
            >
              {testingAll ? 'Marking…' : 'Test all now'}
            </Button>
          </div>
        </Card>
      )}

      <section aria-labelledby="panels-heading" className="section">
        <h2 id="panels-heading" className="section-title">
          Panels
        </h2>
        {loading ? (
          <Skeleton variant="row" count={3} aria-label="Loading panels" />
        ) : panels.length === 0 ? (
          <EmptyState
            illustration={<NoPanels />}
            title="No panels yet"
            description="Use the Add panel button in the header to start mapping your home."
            action={
              <Button
                variant="primary"
                onClick={() => setAddPanelOpen(true)}
                data-testid="empty-state-add-panel"
              >
                Add panel
              </Button>
            }
          />
        ) : (
          <PanelTree nodes={tree} breakerCountByPanel={breakerCountByPanel} />
        )}
      </section>
      {modalNode}
    </>
  );
};

/** G39 cycle-56 — recursive tree renderer. Subpanels nest under their
 *  parent's row inside a `.panel-list__subpanels` ul, with a leading
 *  feeder-breaker marker so the user sees which slot wires them.
 *
 *  Cycle-70 polish-pass-2 — rows now show a "N of M slots used" hint
 *  pinned to the right side of the row card (next to the chevron), so
 *  the previously-empty horizontal space on desktop carries real info. */
const PanelTree = ({
  nodes,
  breakerCountByPanel,
}: {
  nodes: PanelTreeNode[];
  breakerCountByPanel: Map<string, number>;
}): JSX.Element => (
  <ul className="panel-list__ul" data-testid="panel-tree">
    {nodes.map((n) => {
      const count = breakerCountByPanel.get(n.panel.id) ?? 0;
      const summary = `${count} of ${n.panel.slotCount} slots used`;
      return (
        <li key={n.panel.id} className="panel-list__item-wrap">
          <Link
            href={`/panels/${n.panel.id}`}
            className="panel-list__link"
            data-testid="panel-tree-link"
            data-panel-id={n.panel.id}
            data-is-subpanel={n.feederHint !== null ? 'true' : 'false'}
          >
            {n.feederHint !== null && (
              <span className="panel-list__sub-marker" aria-hidden="true">
                <CornerDownRight size={14} strokeWidth={2} />
              </span>
            )}
            <span className="panel-list__name">{n.panel.name}</span>
            {n.feederHint !== null && (
              <span className="panel-list__meta">{n.feederHint}</span>
            )}
            <span
              className="panel-list__summary"
              data-testid="panel-list-summary"
              data-panel-id={n.panel.id}
            >
              {summary}
            </span>
            <span className="panel-list__chev" aria-hidden="true">
              ›
            </span>
          </Link>
          {n.children.length > 0 && (
            <ul
              className="panel-list__subpanels"
              data-testid="panel-tree-children"
            >
              {n.children.map((child) => {
                const childCount = breakerCountByPanel.get(child.panel.id) ?? 0;
                const childSummary = `${childCount} of ${child.panel.slotCount} slots used`;
                return (
                  <li key={child.panel.id} className="panel-list__item-wrap">
                    <Link
                      href={`/panels/${child.panel.id}`}
                      className="panel-list__link"
                      data-testid="panel-tree-link"
                      data-panel-id={child.panel.id}
                      data-is-subpanel="true"
                    >
                      <span
                        className="panel-list__sub-marker"
                        aria-hidden="true"
                      >
                        <CornerDownRight size={14} strokeWidth={2} />
                      </span>
                      <span className="panel-list__name">{child.panel.name}</span>
                      {child.feederHint !== null && (
                        <span className="panel-list__meta">{child.feederHint}</span>
                      )}
                      <span
                        className="panel-list__summary"
                        data-testid="panel-list-summary"
                        data-panel-id={child.panel.id}
                      >
                        {childSummary}
                      </span>
                      <span className="panel-list__chev" aria-hidden="true">
                        ›
                      </span>
                    </Link>
                    {child.children.length > 0 && (
                      <PanelTree
                        nodes={child.children}
                        breakerCountByPanel={breakerCountByPanel}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      );
    })}
  </ul>
);
