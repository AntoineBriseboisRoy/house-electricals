import { useEffect, useState, type FormEvent } from 'react';
import { Button } from './Button.js';
import { Input } from './Input.js';
import { Modal } from './Modal.js';

export type PromptModalProps = {
  open: boolean;
  title: string;
  /** Optional helper text shown above the input. */
  message?: string;
  /** Visible label for the input. */
  label: string;
  /** Initial value in the input. */
  defaultValue?: string;
  /** Placeholder when value is empty. */
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Called when the user submits a non-empty trimmed string. */
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

/** Text-input dialog with Save + Cancel + ENTER-submits. */
export const PromptModal = ({
  open,
  title,
  message,
  label,
  defaultValue = '',
  placeholder,
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  onSubmit,
  onCancel,
}: PromptModalProps): JSX.Element | null => {
  const [value, setValue] = useState(defaultValue);

  // Re-seed the input value whenever the modal re-opens with a new default.
  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    onSubmit(trimmed);
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      testId="prompt-modal"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={onCancel}
            data-testid="prompt-modal-cancel"
          >
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            disabled={value.trim().length === 0}
            onClick={() => {
              const trimmed = value.trim();
              if (trimmed.length > 0) onSubmit(trimmed);
            }}
            data-testid="prompt-modal-confirm"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        {message !== undefined && <p className="modal__message">{message}</p>}
        <Input
          label={label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoFocus
          data-testid="prompt-modal-input"
        />
        {/* Hidden submit button so ENTER in the input fires the form submit
            without needing a visible Save button inside the form body. */}
        <button type="submit" className="visually-hidden" aria-hidden="true">
          {confirmLabel}
        </button>
      </form>
    </Modal>
  );
};
