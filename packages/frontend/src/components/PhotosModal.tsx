import type { AttachmentParentType } from '@he/shared';
import { Modal } from '../ui/Modal.js';
import { PhotoStrip } from './PhotoStrip.js';

type Props = {
  open: boolean;
  onClose: () => void;
  parentType: AttachmentParentType;
  parentId: string;
  /** Short label for the modal title, e.g. the component or breaker name. */
  parentLabel?: string;
};

/**
 * Quick photo viewer/uploader (2026-05). Opens the PhotoStrip in a modal so
 * users can see + add photos WITHOUT entering the full edit form — triggered
 * from a small camera affordance on component + breaker rows. Parent owns the
 * open state (same pattern as ServiceLogModal). Mobile bottom-sheet on phones.
 */
export const PhotosModal = ({
  open,
  onClose,
  parentType,
  parentId,
  parentLabel,
}: Props): JSX.Element => (
  <Modal
    open={open}
    onClose={onClose}
    title={parentLabel ? `Photos — ${parentLabel}` : 'Photos'}
    testId="photos-modal"
    presentation="sheet"
  >
    <PhotoStrip parentType={parentType} parentId={parentId} embedded />
  </Modal>
);
