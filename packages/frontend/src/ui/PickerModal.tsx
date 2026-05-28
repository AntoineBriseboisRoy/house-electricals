import { Button } from './Button.js';
import { Modal } from './Modal.js';

export type PickerOption<T> = {
  /** Stable identity for keying. */
  value: T;
  /** Primary display label. */
  label: string;
  /** Optional secondary hint shown muted under the label. */
  hint?: string;
};

export type PickerModalProps<T> = {
  open: boolean;
  title: string;
  /** Optional helper text above the list. */
  message?: string;
  options: ReadonlyArray<PickerOption<T>>;
  /** Called when the user clicks an option. */
  onPick: (value: T) => void;
  onCancel: () => void;
  /** Shown when options array is empty. */
  emptyMessage?: string;
};

/** List-of-options dialog. Each row is a full-width Button that resolves
 *  the picker with that option's value. */
export const PickerModal = <T,>({
  open,
  title,
  message,
  options,
  onPick,
  onCancel,
  emptyMessage = 'No options available.',
}: PickerModalProps<T>): JSX.Element | null => {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      testId="picker-modal"
      footer={
        <Button
          variant="ghost"
          onClick={onCancel}
          data-testid="picker-modal-cancel"
        >
          Cancel
        </Button>
      }
    >
      {message !== undefined && <p className="modal__message">{message}</p>}
      {options.length === 0 ? (
        <p className="muted">{emptyMessage}</p>
      ) : (
        <ul className="picker-list">
          {options.map((opt, i) => (
            <li key={i}>
              <button
                type="button"
                className="picker-list__item"
                onClick={() => onPick(opt.value)}
                data-testid="picker-modal-option"
                data-value={
                  typeof opt.value === 'string' || typeof opt.value === 'number'
                    ? String(opt.value)
                    : undefined
                }
              >
                <span className="picker-list__label">{opt.label}</span>
                {opt.hint !== undefined && (
                  <span className="picker-list__hint">{opt.hint}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};
