import { Building2 } from 'lucide-react';
import { Button } from './Button.js';
import { toast } from './toast.js';
import { useBuilding } from '../contexts/BuildingContext.js';
import { useModal } from '../hooks/useModal.js';
import { ApiHttpError, movePanelToBuilding, moveFloorToBuilding } from '../api.js';

/**
 * "Move to building…" action (2026-05). Drop into a panel or floor surface.
 * Picks one of the OTHER buildings, moves the entity there (the backend brings
 * its dependent components + cleans up cross-building refs), then switches the
 * active building to the target so the user "follows" the moved item — the
 * route remounts under the new building and re-loads the same entity.
 *
 * Self-contained: owns its own useModal node. Hidden when there's only one
 * building (nothing to move between).
 */
export const MoveToBuildingButton = ({
  kind,
  id,
  name,
}: {
  kind: 'panel' | 'floor';
  id: string;
  name: string;
}): JSX.Element | null => {
  const { buildings, currentBuildingId, switchBuilding } = useBuilding();
  const { pick, modalNode } = useModal();

  const others = buildings.filter((b) => b.id !== currentBuildingId);
  if (others.length === 0) return null; // nowhere to move to

  const handleMove = async (): Promise<void> => {
    const target = await pick<string>({
      title: `Move “${name}” to…`,
      options: others.map((b) => ({ value: b.id, label: b.name })),
    });
    if (target === null) return;
    const targetName = buildings.find((b) => b.id === target)?.name ?? 'building';
    try {
      if (kind === 'panel') {
        await movePanelToBuilding(id, target);
      } else {
        await moveFloorToBuilding(id, target);
      }
      // Follow the item into its new building.
      switchBuilding(target);
      toast.success(`Moved to “${targetName}”`);
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 409) {
        toast.error(err.detail || `A ${kind} with that name already exists in “${targetName}”.`);
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to move.');
      }
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        leadingIcon={<Building2 size={16} strokeWidth={2.25} />}
        onClick={() => void handleMove()}
        data-testid={`move-${kind}-to-building`}
      >
        Move to building…
      </Button>
      {modalNode}
    </>
  );
};
