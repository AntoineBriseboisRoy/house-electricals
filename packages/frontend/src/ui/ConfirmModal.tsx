import { Button, type ButtonVariant } from './Button.js';
import { Modal } from './Modal.js';

export type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string;
  /** Label for the affirmative button. Default 'Confirm'. */
  confirmLabel?: string;
  /** Label for the cancel button. Default 'Cancel'. */
  cancelLabel?: string;
  /** Visual variant for the confirm button. Default 'primary'; use 'danger'
   *  for destructive actions. */
  confirmVariant?: ButtonVariant;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Confirm dialog — Confirm / Cancel buttons + message body. */
export const ConfirmModal = ({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
}: ConfirmModalProps): JSX.Element | null => {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      testId="confirm-modal"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={onCancel}
            data-testid="confirm-modal-cancel"
          >
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            onClick={onConfirm}
            data-testid="confirm-modal-confirm"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="modal__message">{message}</p>
    </Modal>
  );
};
