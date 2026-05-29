import { useState } from 'react';
import { Building2, ChevronsUpDown } from 'lucide-react';
import type { Building } from '@he/shared';
import { useBuilding } from '../contexts/BuildingContext.js';
import { useModal } from '../hooks/useModal.js';
import { ApiHttpError } from '../api.js';
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
  } = useBuilding();
  const { prompt, confirm, modalNode } = useModal();
  const [open, setOpen] = useState(false);

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
        onClose={() => setOpen(false)}
        onSwitch={handleSwitch}
        onCreate={() => void handleCreate()}
        onRename={(b) => void handleRename(b)}
        onDelete={(b) => void handleDelete(b)}
      />
      {modalNode}
    </>
  );
};
