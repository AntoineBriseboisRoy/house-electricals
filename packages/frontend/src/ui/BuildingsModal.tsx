import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Building } from '@he/shared';
import { Modal } from './Modal.js';
import { Button } from './Button.js';
import { IconButton } from './IconButton.js';

/**
 * Buildings chooser/manager (2026-05). Presentational — all mutations are
 * handled by the parent (BuildingSwitcher) via the callbacks, which layer
 * useModal prompt/confirm dialogs on top of this base Modal (the cycle-61f
 * "base Modal + useModal" stacking pattern).
 *
 * Layout: Add is a header-action (top-right, beside the X). Each building row
 * is tap-to-switch, with a pen (rename) + trash (delete) on the right — the
 * per-row destructive affordance convention (IconButton variant="danger" +
 * Trash2). Delete is hidden for the only building (can't delete the last one).
 * The header X is the sole dismiss; there's no footer.
 */
export const BuildingsModal = ({
  open,
  buildings,
  currentBuildingId,
  onClose,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: {
  open: boolean;
  buildings: Building[];
  currentBuildingId: string | null;
  onClose: () => void;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (building: Building) => void;
  onDelete: (building: Building) => void;
}): JSX.Element => {
  const canDelete = buildings.length > 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Buildings"
      testId="buildings-modal"
      presentation="sheet"
      headerAction={
        <Button
          variant="primary"
          size="sm"
          leadingIcon={<Plus size={16} strokeWidth={2.5} />}
          onClick={onCreate}
          data-testid="buildings-modal-add"
        >
          Add
        </Button>
      }
    >
      <ul className="buildings-list" data-testid="buildings-list">
        {buildings.map((b) => {
          const isCurrent = b.id === currentBuildingId;
          return (
            <li
              key={b.id}
              className={
                'buildings-list__row' +
                (isCurrent ? ' buildings-list__row--current' : '')
              }
            >
              <button
                type="button"
                className="buildings-list__pick"
                onClick={() => onSwitch(b.id)}
                data-testid="buildings-list-switch"
                data-building-id={b.id}
                aria-current={isCurrent || undefined}
              >
                <span className="buildings-list__name">{b.name}</span>
                {isCurrent && (
                  <span className="buildings-list__badge">Current</span>
                )}
              </button>
              <IconButton
                icon={<Pencil size={16} strokeWidth={2.25} />}
                aria-label={`Rename ${b.name}`}
                variant="ghost"
                onClick={() => onRename(b)}
                data-testid="buildings-list-rename"
              />
              {canDelete && (
                <IconButton
                  icon={<Trash2 size={16} strokeWidth={2.25} />}
                  aria-label={`Delete ${b.name}`}
                  variant="ghost"
                  onClick={() => onDelete(b)}
                  data-testid="buildings-list-delete"
                />
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
};
