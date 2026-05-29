import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import type { ServiceEntry, ServiceEntryParentType } from '@he/shared';
import { Button } from './Button.js';
import { IconButton } from './IconButton.js';
import { Modal } from './Modal.js';
import { Textarea } from './Textarea.js';
import { formatRelative } from '../lib/relativeTime.js';
import {
  dateInputValue,
  epochFromDateInputStart,
  formatDate,
} from '../lib/datetime.js';

export type ServiceLogModalProps = {
  open: boolean;
  /** Display title — e.g. "Slot 6: Kitchen lights" or component name. */
  parentLabel: string;
  /** Which parent surface — drives microcopy ("breaker" vs "component"). */
  parentType: ServiceEntryParentType;
  /** Existing entries, sorted DESC by occurredAt. Always passed (parent
   *  owns the list state so add/delete optimistic mutations are coordinated). */
  entries: ReadonlyArray<ServiceEntry>;
  /** Called when the user submits the "Add entry" form. Parent persists
   *  via createBreaker/ComponentServiceEntry + refreshes the entries list. */
  onAddEntry: (input: { note: string; occurredAt: number }) => Promise<void>;
  /** Called when the user clicks the trash icon on an entry. Parent
   *  persists via deleteServiceEntry + refreshes the list. */
  onDeleteEntry: (id: string) => Promise<void>;
  onClose: () => void;
};

/**
 * G40 Part 1 cycle-66 — ServiceLogModal.
 *
 * Renders a dated service-log timeline for a single parent (breaker or
 * component) inside a base Modal. Pinned in CLAUDE.md "Service-log
 * entries (G40 Part 1 — cycle-66)":
 *  - Timeline ALWAYS opens in Modal — NEVER inline-expanded in BreakerRow
 *    (mobile vertical-space pins from cycle-34/36).
 *  - Uses base Modal (NOT useModal) — caller controls open state.
 *  - "Add entry" form lives at the bottom of the modal: textarea + date
 *    input (defaults to today; user can backdate).
 */
export const ServiceLogModal = ({
  open,
  parentLabel,
  parentType,
  entries,
  onAddEntry,
  onDeleteEntry,
  onClose,
}: ServiceLogModalProps): JSX.Element | null => {
  const [note, setNote] = useState('');
  const [dateStr, setDateStr] = useState(() => dateInputValue(Date.now()));
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const trimmed = note.trim();
    if (trimmed.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      // Anchor occurredAt to the picked date's midnight in the app timezone so
      // backdating lands on the user's chosen day. Future cycles may expose a
      // time picker — for v1 day-granularity is enough.
      const occurredAt = epochFromDateInputStart(dateStr) ?? Date.now();
      await onAddEntry({ note: trimmed, occurredAt });
      // Reset for next entry. Keep the date as "today" so the next add
      // doesn't carry the previous backdate forward (likely a footgun).
      setNote('');
      setDateStr(dateInputValue(Date.now()));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Service log — ${parentLabel}`}
      testId="service-log-modal"
      presentation="sheet"
      footer={
        <Button
          variant="secondary"
          onClick={onClose}
          data-testid="service-log-modal-close"
        >
          Close
        </Button>
      }
    >
      <p
        className="modal__message service-log-modal__subtitle"
        data-testid="service-log-modal-subtitle"
      >
        {entries.length === 0
          ? 'No entries yet — log your first service event below.'
          : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} on record.`}
      </p>

      {entries.length > 0 && (
        <ul className="service-log-modal__list" data-testid="service-log-modal-list">
          {entries.map((e) => (
            <li
              key={e.id}
              className="service-log-modal__item"
              data-testid="service-log-modal-item"
              data-entry-id={e.id}
            >
              <div className="service-log-modal__item-head">
                <span className="service-log-modal__item-date">
                  {formatDate(e.occurredAt)}
                </span>
                <span className="service-log-modal__item-relative muted">
                  · {formatRelative(e.occurredAt)}
                </span>
                <IconButton
                  icon={<Trash2 size={14} strokeWidth={2.25} />}
                  aria-label="Delete entry"
                  variant="ghost"
                  onClick={() => {
                    void onDeleteEntry(e.id);
                  }}
                  data-testid="service-log-modal-delete"
                  data-entry-id={e.id}
                />
              </div>
              <p className="service-log-modal__item-note">{e.note}</p>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(ev) => {
          void handleSubmit(ev);
        }}
        className="service-log-modal__form"
        data-testid="service-log-modal-form"
      >
        <h3 className="service-log-modal__form-title">Add entry</h3>
        <label className="service-log-modal__field">
          <span className="service-log-modal__field-label">Date</span>
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            max={dateInputValue(Date.now())}
            className="service-log-modal__date-input"
            data-testid="service-log-modal-date"
            aria-label="Date of service event"
          />
        </label>
        <div className="service-log-modal__field">
          {/* Cycle-71: Textarea primitive replaces the bespoke textarea.
              data-testid preserved per cycle-66 G40 rule #9. */}
          <Textarea
            label={`Note (${parentType === 'breaker' ? 'what was serviced' : 'what was changed'})`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              parentType === 'breaker'
                ? 'e.g. tightened terminal screws, retorqued lugs'
                : 'e.g. replaced GFCI outlet, swapped bulb'
            }
            rows={3}
            maxLength={2000}
            data-testid="service-log-modal-note"
          />
        </div>
        <div className="service-log-modal__form-actions">
          <Button
            variant="primary"
            type="submit"
            busy={submitting}
            disabled={note.trim().length === 0 || submitting}
            data-testid="service-log-modal-submit"
          >
            {submitting ? 'Adding…' : 'Add entry'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
