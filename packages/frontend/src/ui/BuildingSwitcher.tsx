import { useState } from 'react';
import { Building2, ChevronsUpDown } from 'lucide-react';
import type { Building } from '@he/shared';
import { useBuilding } from '../contexts/BuildingContext.js';
import { useModal } from '../hooks/useModal.js';
import { ApiHttpError, importBuilding } from '../api.js';
import { toast } from './toast.js';
import { BuildingsModal } from './BuildingsModal.js';

/**
 * Multi-building switcher (2026-05). A compact pill at the top of the app
 * chrome showing the current building; tapping it opens <BuildingsModal>
 * (Add top-right, a pen per row to rename, Delete in the footer). Switching
 * re-scopes every data fetch (BuildingContext sets the active building) and
 * remounts the routed screens (App keys them on the building id).
 *
 * Create/rename/delete use the useModal prompt/confirm dialogs layered ON TOP
 * of the BuildingsModal — the cycle-61f base-Modal + useModal stacking pattern
 * (separate render surfaces, no replace-policy collision).
 */
export const BuildingSwitcher = (): JSX.Element => {
  const {
    buildings,
    currentBuilding,
    currentBuildingId,
    switchBuilding,
    createBuilding,
    renameBuilding,
    deleteBuilding,
    refresh,
  } = useBuilding();
  const { prompt, confirm, modalNode } = useModal();
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleSwitch = (id: string): void => {
    if (id !== currentBuildingId) switchBuilding(id);
    setOpen(false);
  };

  const handleCreate = async (): Promise<void> => {
    const name = await prompt({
      title: 'New building',
      label: 'Building name',
      placeholder: 'e.g. Garage, Rental, Cottage',
    });
    if (name === null) return;
    try {
      await createBuilding(name);
      setOpen(false);
      toast.success(`Created “${name}” — now editing it`);
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 409) {
        toast.error(`“${name}” already exists.`);
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to create building.');
      }
    }
  };

  const handleRename = async (building: Building): Promise<void> => {
    const name = await prompt({
      title: 'Rename building',
      label: 'Building name',
      defaultValue: building.name,
    });
    if (name === null || name === building.name) return;
    try {
      await renameBuilding(building.id, name);
      toast.success('Building renamed');
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 409) {
        toast.error(`“${name}” already exists.`);
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to rename.');
      }
    }
  };

  const handleDelete = async (building: Building): Promise<void> => {
    const ok = await confirm({
      title: `Delete “${building.name}”?`,
      message:
        'This permanently deletes the building and ALL of its panels, floors, rooms, and components. This cannot be undone.',
      confirmLabel: 'Delete building',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      // Deleting the active building re-points the active selection to a
      // remaining one (BuildingContext handles it). The modal stays open so
      // you can manage several in a row; the list updates in place.
      await deleteBuilding(building.id);
      toast.success(`Deleted “${building.name}”`);
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 409) {
        toast.error(err.detail || "You can't delete your only building.");
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to delete.');
      }
    }
  };

  /**
   * G43 — restore a building from a previously-exported JSON file. Reads +
   * parses the file (bad JSON → toast), POSTs the envelope to
   * /api/v1/buildings/import, then refreshes the building list, switches the
   * active building to the freshly restored copy, and closes the modal. The
   * backend 400 messages (wrong format / unsupported version) are
   * user-meaningful, so we pull `.error.message` out of the ApiHttpError
   * detail and surface it verbatim.
   */
  const handleImport = async (file: File): Promise<void> => {
    setImporting(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        toast.error('That file isn’t valid JSON.');
        return;
      }
      const building = await importBuilding(parsed);
      // The building is saved server-side now. Refresh the list best-effort —
      // a transient GET /buildings hiccup must NOT fall into the catch below
      // and falsely toast "could not import" (which would tempt a duplicate
      // re-import). Worst case the list catches up on the next natural load.
      try {
        await refresh();
      } catch {
        /* list updates on next load — the import already succeeded */
      }
      switchBuilding(building.id);
      toast.success(`Imported “${building.name}”.`);
      setOpen(false);
    } catch (err) {
      let message = 'Could not import that building.';
      if (err instanceof ApiHttpError) {
        // The backend's error body is { error: { message } }; ApiHttpError
        // carries the raw response text in `detail`.
        try {
          const body = JSON.parse(err.detail) as {
            error?: { message?: string };
          };
          if (body.error?.message) message = body.error.message;
          else if (err.detail) message = err.detail;
        } catch {
          if (err.detail) message = err.detail;
        }
      } else if (err instanceof Error && err.message) {
        message = err.message;
      }
      toast.error(message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="building-switcher"
        onClick={() => setOpen(true)}
        data-testid="building-switcher"
        aria-label={`Current building: ${currentBuilding?.name ?? 'none'}. Tap to switch.`}
      >
        <Building2 size={16} strokeWidth={2.25} aria-hidden="true" />
        <span className="building-switcher__name">
          {currentBuilding?.name ?? 'Select building'}
        </span>
        <ChevronsUpDown size={14} strokeWidth={2.5} aria-hidden="true" />
      </button>
      <BuildingsModal
        open={open}
        buildings={buildings}
        currentBuildingId={currentBuildingId}
        busy={importing}
        onClose={() => setOpen(false)}
        onSwitch={handleSwitch}
        onCreate={() => void handleCreate()}
        onRename={(b) => void handleRename(b)}
        onDelete={(b) => void handleDelete(b)}
        onImport={(file) => void handleImport(file)}
      />
      {modalNode}
    </>
  );
};
