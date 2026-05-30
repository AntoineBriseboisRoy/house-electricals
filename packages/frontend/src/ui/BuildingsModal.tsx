import { useRef } from 'react';
import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
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
 *
 * G43 (2026-05) — an Import block (file-picker) sits next to the Export block:
 * inverse operations grouped together. The hidden <input type=file> + visible
 * Button live here (so the DOM contract / testids are on the modal), but the
 * actual file-read → POST → refresh → switch → toast → close flow is owned by
 * the parent via `onImport(file)`, keeping this modal presentational.
 */
export const BuildingsModal = ({
  open,
  buildings,
  currentBuildingId,
  busy = false,
  onClose,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onImport,
}: {
  open: boolean;
  buildings: Building[];
  currentBuildingId: string | null;
  /** G43 — true while an import is in flight; disables the import control. */
  busy?: boolean;
  onClose: () => void;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (building: Building) => void;
  onDelete: (building: Building) => void;
  /** G43 — hand the picked export file to the parent to restore. */
  onImport: (file: File) => void;
}): JSX.Element => {
  const canDelete = buildings.length > 1;
  const importInputRef = useRef<HTMLInputElement>(null);

  const onImportInputChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ): void => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again re-fires change.
    e.target.value = '';
    if (file) onImport(file);
  };

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

      {/* 2026-05 — export the CURRENT building's data. Plain <a download>
          links: same-origin GETs that carry the auth cookie; the backend
          replies with Content-Disposition: attachment. JSON = full tree;
          CSV = the printable circuit directory (breaker → components). */}
      {currentBuildingId !== null &&
        (() => {
          const current = buildings.find((b) => b.id === currentBuildingId);
          if (current === undefined) return null;
          const base = `/api/v1/buildings/${encodeURIComponent(current.id)}/export`;
          return (
            <div className="buildings-export" data-testid="buildings-export">
              <span className="buildings-export__label">
                <Download size={15} strokeWidth={2.25} aria-hidden="true" />
                Export “{current.name}”
              </span>
              <div className="buildings-export__links">
                <a
                  className="btn btn--secondary btn--sm"
                  href={`${base}.json`}
                  download
                  data-testid="buildings-export-json"
                >
                  JSON (full backup)
                </a>
                <a
                  className="btn btn--secondary btn--sm"
                  href={`${base}.csv`}
                  download
                  data-testid="buildings-export-csv"
                >
                  CSV (circuit directory)
                </a>
              </div>
            </div>
          );
        })()}

      {/* G43 (2026-05) — import a building from a previously-exported JSON
          file. Inverse of Export above; reuses the .buildings-export* layout
          classes (no new CSS). The hidden <input> is triggered by the visible
          Button (the standard accessible file-picker idiom — see PhotoStrip).
          The parent owns the read/POST/refresh/switch/toast/close flow. */}
      <div className="buildings-export" data-testid="buildings-import">
        <span className="buildings-export__label">
          <Upload size={15} strokeWidth={2.25} aria-hidden="true" />
          Import a building
        </span>
        <div className="buildings-export__links">
          <Button
            variant="secondary"
            size="sm"
            busy={busy}
            disabled={busy}
            leadingIcon={<Upload size={16} strokeWidth={2.25} />}
            onClick={() => importInputRef.current?.click()}
            data-testid="buildings-import-button"
          >
            {busy ? 'Importing…' : 'Import building'}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={onImportInputChange}
            disabled={busy}
            aria-hidden="true"
            tabIndex={-1}
            data-testid="buildings-import-input"
          />
        </div>
      </div>
    </Modal>
  );
};
