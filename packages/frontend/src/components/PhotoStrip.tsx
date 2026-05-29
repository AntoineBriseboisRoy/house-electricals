import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, X } from 'lucide-react';
import type { Attachment, AttachmentParentType } from '@he/shared';
import { deletePhoto, listPhotos, photoUrl, uploadPhoto } from '../api.js';
import { Button } from '../ui/Button.js';
import { IconButton } from '../ui/IconButton.js';
import { Spinner } from '../ui/Spinner.js';
import { toast } from '../ui/toast.js';
import { useModal } from '../hooks/useModal.js';

type Props = {
  parentType: AttachmentParentType;
  parentId: string;
  /** When rendered as the sole content of a modal (PhotosModal), drop the
   *  top divider/spacing — the modal already has its own header rule, so the
   *  strip's separator would read as a stray "middle bar". Default false
   *  keeps the separator for inline use (e.g. the FloorEdit drawer, where it
   *  divides the photos from the info above). */
  embedded?: boolean;
};

/**
 * Photos on a component or breaker (2026-05). A thumbnail strip + an
 * "Add photo" button (camera capture on mobile via `capture`), plus a
 * tap-to-zoom lightbox and a per-thumbnail delete.
 *
 * Self-contained: loads/uploads/deletes via api.ts keyed on
 * (parentType, parentId). Photo upload is an explicit user action.
 */
export const PhotoStrip = ({
  parentType,
  parentId,
  embedded = false,
}: Props): JSX.Element => {
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { confirm, modalNode } = useModal();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listPhotos(parentType, parentId)
      .then((list) => {
        if (!cancelled) setPhotos(list);
      })
      .catch(() => {
        if (!cancelled) setPhotos([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [parentType, parentId]);

  // ESC closes the lightbox.
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const handleFile = async (file: File): Promise<void> => {
    setUploading(true);
    try {
      const created = await uploadPhoto(parentType, parentId, file);
      setPhotos((prev) => [...prev, created]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to upload photo.');
    } finally {
      setUploading(false);
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again re-fires change.
    e.target.value = '';
    if (file) void handleFile(file);
  };

  const handleDelete = async (att: Attachment): Promise<void> => {
    const ok = await confirm({
      title: 'Delete this photo?',
      message: 'This removes the photo permanently.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    const prev = photos;
    setPhotos((p) => p.filter((x) => x.id !== att.id));
    try {
      await deletePhoto(att.id);
    } catch (e) {
      setPhotos(prev); // roll back
      toast.error(e instanceof Error ? e.message : 'Failed to delete photo.');
    }
  };

  return (
    <div
      className={'photo-strip' + (embedded ? ' photo-strip--embedded' : '')}
      data-testid="photo-strip"
    >
      <div className="photo-strip__head">
        {!embedded && <span className="photo-strip__label">Photos</span>}
        <Button
          type="button"
          variant="primary"
          size="sm"
          leadingIcon={<ImagePlus size={16} aria-hidden="true" />}
          busy={uploading}
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          data-testid="photo-strip-add"
        >
          {uploading ? 'Uploading…' : 'Add photo'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          capture="environment"
          className="photo-strip__input"
          onChange={onInputChange}
          data-testid="photo-strip-input"
        />
      </div>

      {loading ? (
        <div className="photo-strip__loading">
          <Spinner size={16} label="Loading photos" />
        </div>
      ) : photos.length === 0 ? (
        <p className="photo-strip__empty">No photos yet.</p>
      ) : (
        <ul className="photo-strip__grid" data-testid="photo-strip-grid">
          {photos.map((p) => (
            <li
              key={p.id}
              className="photo-strip__item"
              data-testid="photo-strip-item"
              data-photo-id={p.id}
            >
              <button
                type="button"
                className="photo-strip__thumb"
                onClick={() => setLightbox(photoUrl(p.filename))}
                aria-label="View photo"
              >
                <img src={photoUrl(p.filename)} alt="" loading="lazy" />
              </button>
              <IconButton
                icon={<Trash2 size={16} aria-hidden="true" />}
                aria-label="Delete photo"
                variant="danger"
                className="photo-strip__delete"
                data-testid="photo-strip-delete"
                onClick={() => void handleDelete(p)}
              />
            </li>
          ))}
        </ul>
      )}

      {lightbox !== null && (
        <div
          className="photo-lightbox"
          data-testid="photo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
          onClick={() => setLightbox(null)}
        >
          <IconButton
            icon={<X size={20} aria-hidden="true" />}
            aria-label="Close photo"
            variant="default"
            className="photo-lightbox__close"
            onClick={() => setLightbox(null)}
          />
          <img
            className="photo-lightbox__img"
            src={lightbox}
            alt=""
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      {modalNode}
    </div>
  );
};
