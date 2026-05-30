import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { Plus } from 'lucide-react';
import type { Floor, ResolvedComponent } from '@he/shared';
import {
  ApiHttpError,
  createFloor,
  listComponents,
  listFloors,
} from '../api.js';
import { suffixDuplicate } from '../lib/duplicateName.js';
import { useModal } from '../hooks/useModal.js';
import {
  Button,
  EmptyState,
  Input,
  Modal,
  NoFloors,
  ScreenHeader,
  Skeleton,
  toast,
} from '../ui/index.js';

/**
 * Landing route for the Map tab.
 *
 * Refactor 2026-05 — single-purpose: lists the house's floors with a
 * tap-to-open row + an "Add floor" header CTA. The old Panels section
 * (which linked to the per-panel /panels/:id/map view) was dropped — panel
 * management lives on the Panels tab; deep "where are this panel's
 * components?" navigation now goes through the floor canvas via the
 * breaker-context drawer.
 */
export const MapLandingScreen = (): JSX.Element => {
  const [, setLocation] = useLocation();
  const [floors, setFloors] = useState<Floor[]>([]);
  /** Refactor 2026-05 iter-4 — per-floor placed-component counts so each
   *  row carries a "12 components" badge. Counts include unwired
   *  components (anything with a floorId), since the map cares about
   *  spatial placement, not breaker assignment. */
  const [componentsByFloor, setComponentsByFloor] = useState<
    ReadonlyMap<string, number>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [floorName, setFloorName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Cycle-62 — "Add a floor" is now a header CTA that opens a base-Modal
  // (NOT useModal()) wrapper. The base Modal is a separate render surface
  // from useModal's singleton, so the 409-retry prompt below doesn't
  // collide with the open-add wrapper (which would drop the typed name).
  const [addFloorOpen, setAddFloorOpen] = useState(false);
  const { prompt, modalNode } = useModal();

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [f, components] = await Promise.all([
        listFloors(),
        listComponents(),
      ]);
      setFloors(f);
      const counts = new Map<string, number>();
      for (const c of components as readonly ResolvedComponent[]) {
        if (c.floorId === null) continue;
        counts.set(c.floorId, (counts.get(c.floorId) ?? 0) + 1);
      }
      setComponentsByFloor(counts);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * G42(a) cycle-49 — create-with-409-retry. Same shape as PanelListScreen's
   * attemptCreate; on 409 we suggest a suffixed candidate via prompt and
   * recurse if the user accepts.
   */
  const attemptCreateFloor = useCallback(
    async (candidate: string): Promise<boolean> => {
      try {
        const created = await createFloor({ name: candidate });
        toast.success('Floor created');
        // Cycle-62 — close the Add-floor modal on success. Defensive even
        // though the setLocation() below unmounts the screen anyway;
        // keeps state tidy if navigation is intercepted/replaced.
        setAddFloorOpen(false);
        // Navigate straight into the new floor's editor — no dead-end. The
        // back button still returns to /map (we use a normal push, not
        // replace, so /map → /floors/:id/edit is part of history).
        setLocation(`/floors/${created.id}/edit`);
        return true;
      } catch (err) {
        if (err instanceof ApiHttpError && err.status === 409) {
          const suggested = suffixDuplicate(candidate);
          toast.error(`Name "${candidate}" is taken — try "${suggested}"?`);
          const retry = await prompt({
            title: 'Pick a different name',
            label: 'Floor name',
            defaultValue: suggested,
          });
          if (retry === null) return false;
          return attemptCreateFloor(retry);
        }
        toast.error(err instanceof Error ? err.message : 'Failed to create floor.');
        return false;
      }
    },
    [prompt, setLocation]
  );

  const handleCreateFloor = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const trimmed = floorName.trim();
    if (trimmed.length === 0) return;
    setSubmitting(true);
    try {
      const ok = await attemptCreateFloor(trimmed);
      if (ok) setFloorName('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <ScreenHeader title="Maps" subtitle="Floors and panel maps">
        <Button
          variant="primary"
          size="sm"
          leadingIcon={<Plus size={16} strokeWidth={2.25} />}
          onClick={() => setAddFloorOpen(true)}
          data-testid="open-add-floor"
          aria-label="Add a floor"
        >
          Floor
        </Button>
      </ScreenHeader>

      {/* Cycle-62 — Add-a-floor lives in a Modal triggered by the
          ScreenHeader CTA. Was an always-visible Card eating ~half the
          screen on what's primarily a list view. Cancel + Close (X)
          dismiss; success auto-closes + navigates to the new editor.

          Wrapper is the BASE Modal (not useModal()) so the 409-retry
          PromptModal (singleton-replaced by useModal) doesn't tear this
          wrapper down mid-create and drop the user's typed name. */}
      <Modal
        open={addFloorOpen}
        onClose={() => setAddFloorOpen(false)}
        title="Add a floor"
        testId="add-floor-modal"
        presentation="sheet"
      >
        <form onSubmit={handleCreateFloor}>
          <Input
            label={null}
            aria-label="Floor name"
            placeholder="e.g. Basement, Main, Second"
            value={floorName}
            onChange={(e) => setFloorName(e.target.value)}
            disabled={submitting}
            autoComplete="off"
          />
          {/* Cycle-65 P1 — Cancel + Create footer to match the Add Component
              modal pattern (sibling cycle-62 consumers were inconsistent —
              Add Component had Cancel, Add Panel/Floor did not). */}
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAddFloorOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              busy={submitting}
              disabled={submitting || floorName.trim().length === 0}
              leadingIcon={<Plus size={18} strokeWidth={2.25} />}
            >
              {submitting ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>

      <section className="section" aria-labelledby="floors-heading">
        <h2 id="floors-heading" className="section-title">
          Floors
        </h2>
        {loading ? (
          <Skeleton variant="row" count={2} aria-label="Loading floors" />
        ) : floors.length === 0 ? (
          <EmptyState
            illustration={<NoFloors />}
            title="No floors yet"
            description="Use the Add floor button in the header to start (e.g. Basement, Main, Second). Components on your panels can then be placed on whichever floor they belong to."
            action={
              <Button
                variant="primary"
                onClick={() => setAddFloorOpen(true)}
                data-testid="empty-state-add-floor"
              >
                Add floor
              </Button>
            }
          />
        ) : (
          <ul className="panel-list__ul">
            {floors.map((f) => {
              const placed = componentsByFloor.get(f.id) ?? 0;
              const placedCopy =
                placed === 0
                  ? 'No components placed yet'
                  : `${placed} ${placed === 1 ? 'component' : 'components'} placed`;
              const planCopy = f.floorPlan ? '· has plan' : '· no plan';
              return (
                <li
                  key={f.id}
                  className="panel-list__item-wrap"
                  data-testid="map-landing-floor-row"
                  data-floor-id={f.id}
                >
                  <Link
                    href={`/floors/${f.id}/edit`}
                    className="panel-list__link"
                  >
                    <span className="panel-list__name">{f.name}</span>
                    <span className="panel-list__meta">
                      {placedCopy} {planCopy}
                    </span>
                    <span className="panel-list__chev" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {modalNode}
    </>
  );
};
