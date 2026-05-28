import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Floor } from '@he/shared';
import { Button } from './Button.js';
import { Modal } from './Modal.js';
import { Tooltip } from './Tooltip.js';
import { ComponentTypeIcon } from '../components/ComponentTypeIcon.js';
import type { ImpactItem } from '../lib/impact.js';

export type ImpactModalProps = {
  open: boolean;
  /** Breaker slot label, e.g. "Slot 6" or "Slot 6a" (tandem). */
  breakerLabel: string;
  /** Pre-computed impact items (output of computeImpact). */
  items: ReadonlyArray<ImpactItem>;
  /** Floor lookup for grouping items by floor name. */
  floorById: ReadonlyMap<string, Floor>;
  onClose: () => void;
};

/**
 * G35 Part 1 (cycle-58) — Impact modal.
 *
 * Read-only "what dies if I flip this breaker?" view. Renders a list of
 * components grouped by floor → room. Items wired directly to the
 * breaker are flat; items reached via a subpanel feeder chain (cycle-57
 * cascade) carry a small "via <Subpanel>" badge.
 *
 * No state mutation, no "simulate flip" toggle — TestPanelScreen remains
 * the interactive walkthrough surface. This modal is a precomputed
 * snapshot.
 */
export const ImpactModal = ({
  open,
  breakerLabel,
  items,
  floorById,
  onClose,
}: ImpactModalProps): JSX.Element | null => {
  type Group = {
    floorKey: string;
    floorName: string;
    rooms: Map<string, ImpactItem[]>;
  };

  const groups = useMemo<Group[]>(() => {
    const byFloor = new Map<string, Group>();
    for (const item of items) {
      const fid = item.component.floorId;
      const floorName =
        fid !== null
          ? floorById.get(fid)?.name ?? '(unknown floor)'
          : '(no floor)';
      const floorKey = fid ?? '__none__';
      let group = byFloor.get(floorKey);
      if (group === undefined) {
        group = { floorKey, floorName, rooms: new Map() };
        byFloor.set(floorKey, group);
      }
      const roomKey = item.component.room ?? '(no room)';
      const arr = group.rooms.get(roomKey);
      if (arr === undefined) {
        group.rooms.set(roomKey, [item]);
      } else {
        arr.push(item);
      }
    }
    // Stable display order: floors alphabetical with "(no floor)" last;
    // rooms alphabetical with "(no room)" last.
    return Array.from(byFloor.values()).sort((a, b) => {
      if (a.floorKey === '__none__') return 1;
      if (b.floorKey === '__none__') return -1;
      return a.floorName.localeCompare(b.floorName);
    });
  }, [items, floorById]);

  const count = items.length;
  const subtitle =
    count === 0
      ? 'Nothing loses power.'
      : `${count} component${count === 1 ? '' : 's'} lose${count === 1 ? 's' : ''} power`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`If you flip ${breakerLabel} off…`}
      testId="impact-modal"
      footer={
        <Button
          variant="secondary"
          onClick={onClose}
          data-testid="impact-modal-close"
        >
          Close
        </Button>
      }
    >
      <p className="modal__message impact-modal__subtitle" data-testid="impact-modal-subtitle">
        {subtitle}
      </p>
      {groups.length > 0 && (
        <div className="impact-modal__scroll">
          {groups.map((g) => (
            <section
              key={g.floorKey}
              className="impact-modal__group"
              data-testid="impact-modal-floor-group"
              data-floor-key={g.floorKey}
            >
              <h3 className="impact-modal__floor-name">{g.floorName}</h3>
              {Array.from(g.rooms.entries())
                .sort((a, b) => {
                  if (a[0] === '(no room)') return 1;
                  if (b[0] === '(no room)') return -1;
                  return a[0].localeCompare(b[0]);
                })
                .map(([roomKey, roomItems]) => {
                  // G35 Part 2 cycle-59 — within each room group, critical
                  // items bubble to the top; non-critical follow alphabetical.
                  // Preserves the cycle-58 floor→room grouping ADR (Devil
                  // OBJ3 option b): critical items are NOT lifted into a
                  // separate top-of-modal section.
                  const sortedItems = roomItems.slice().sort((a, b) => {
                    if (a.component.critical !== b.component.critical) {
                      return a.component.critical ? -1 : 1;
                    }
                    return a.component.name.localeCompare(b.component.name);
                  });
                  return (
                    <div key={roomKey} className="impact-modal__room">
                      <h4 className="impact-modal__room-name">{roomKey}</h4>
                      <ul className="impact-modal__items">
                        {sortedItems.map((it) => (
                          <li
                            key={it.component.id}
                            className="impact-modal__item"
                            data-testid="impact-modal-item"
                            data-component-id={it.component.id}
                            data-reason={it.reason}
                            data-critical={it.component.critical ? 'true' : 'false'}
                          >
                            <span
                              className="impact-modal__item-icon"
                              aria-hidden="true"
                            >
                              <ComponentTypeIcon
                                type={it.component.type}
                                size={18}
                              />
                            </span>
                            <span className="impact-modal__item-name">
                              {it.component.name}
                            </span>
                            {it.component.critical && (
                              <Tooltip content="Marked as critical (priority for backup power)">
                                <span
                                  className="badge badge--critical"
                                  data-testid="badge-critical"
                                  tabIndex={0}
                                >
                                  <AlertTriangle
                                    size={11}
                                    strokeWidth={2.5}
                                    aria-hidden="true"
                                  />
                                  <span>Critical</span>
                                </span>
                              </Tooltip>
                            )}
                            {it.reason === 'cascade' &&
                              it.viaSubpanel !== undefined && (
                                <span
                                  className="impact-modal__cascade-via"
                                  data-testid="impact-modal-cascade-via"
                                >
                                  via {it.viaSubpanel}
                                </span>
                              )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
};
