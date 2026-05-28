import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ConfirmModal } from '../ui/ConfirmModal.js';
import { PickerModal, type PickerOption } from '../ui/PickerModal.js';
import { PromptModal } from '../ui/PromptModal.js';
import type { ButtonVariant } from '../ui/Button.js';

/**
 * Imperative modal API. The hook returns:
 *   - confirm(opts) → Promise<boolean>
 *   - prompt(opts)  → Promise<string | null>   (null on cancel)
 *   - pick<T>(opts) → Promise<T | null>        (null on cancel)
 *   - modalNode     → JSX to render at the screen root
 *
 * Only ONE modal can be open at a time per hook instance. Concurrent calls
 * resolve the prior one with null/false (replace-policy) — simpler than a
 * queue and good enough for one-shot dialogs.
 *
 * Usage:
 *   const { confirm, modalNode } = useModal();
 *   const ok = await confirm({ title: 'Delete?', message: '…', confirmVariant: 'danger' });
 *   if (!ok) return;
 *   …
 *   return <>{children}{modalNode}</>;
 */

type ConfirmOpts = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
};

type PromptOpts = {
  title: string;
  message?: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type PickOpts<T> = {
  title: string;
  message?: string;
  options: ReadonlyArray<PickerOption<T>>;
  emptyMessage?: string;
};

type ActiveSlot =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void }
  | {
      kind: 'pick';
      opts: PickOpts<unknown>;
      resolve: (v: unknown | null) => void;
    };

export type UseModalResult = {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
  pick: <T>(opts: PickOpts<T>) => Promise<T | null>;
  modalNode: ReactNode;
};

export const useModal = (): UseModalResult => {
  const [active, setActive] = useState<ActiveSlot | null>(null);
  /** Stable ref to the active slot's resolver — used to clean up if a new
   *  call replaces this one. */
  const activeRef = useRef<ActiveSlot | null>(null);
  activeRef.current = active;

  const closeWithReplace = useCallback((): void => {
    // If something is currently open, resolve its promise with cancel-equivalent
    // before swapping in a new slot.
    const cur = activeRef.current;
    if (cur === null) return;
    if (cur.kind === 'confirm') cur.resolve(false);
    else cur.resolve(null);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOpts): Promise<boolean> => {
      closeWithReplace();
      return new Promise<boolean>((resolve) => {
        setActive({ kind: 'confirm', opts, resolve });
      });
    },
    [closeWithReplace]
  );

  const prompt = useCallback(
    (opts: PromptOpts): Promise<string | null> => {
      closeWithReplace();
      return new Promise<string | null>((resolve) => {
        setActive({ kind: 'prompt', opts, resolve });
      });
    },
    [closeWithReplace]
  );

  const pick = useCallback(
    <T,>(opts: PickOpts<T>): Promise<T | null> => {
      closeWithReplace();
      return new Promise<T | null>((resolve) => {
        setActive({
          kind: 'pick',
          opts: opts as PickOpts<unknown>,
          resolve: resolve as (v: unknown | null) => void,
        });
      });
    },
    [closeWithReplace]
  );

  const close = useCallback((): void => {
    setActive(null);
  }, []);

  let modalNode: ReactNode = null;
  if (active !== null) {
    if (active.kind === 'confirm') {
      modalNode = (
        <ConfirmModal
          open
          title={active.opts.title}
          message={active.opts.message}
          confirmLabel={active.opts.confirmLabel}
          cancelLabel={active.opts.cancelLabel}
          confirmVariant={active.opts.confirmVariant}
          onConfirm={() => {
            active.resolve(true);
            close();
          }}
          onCancel={() => {
            active.resolve(false);
            close();
          }}
        />
      );
    } else if (active.kind === 'prompt') {
      modalNode = (
        <PromptModal
          open
          title={active.opts.title}
          message={active.opts.message}
          label={active.opts.label}
          defaultValue={active.opts.defaultValue}
          placeholder={active.opts.placeholder}
          confirmLabel={active.opts.confirmLabel}
          cancelLabel={active.opts.cancelLabel}
          onSubmit={(v) => {
            active.resolve(v);
            close();
          }}
          onCancel={() => {
            active.resolve(null);
            close();
          }}
        />
      );
    } else {
      modalNode = (
        <PickerModal
          open
          title={active.opts.title}
          message={active.opts.message}
          options={active.opts.options}
          emptyMessage={active.opts.emptyMessage}
          onPick={(v) => {
            active.resolve(v);
            close();
          }}
          onCancel={() => {
            active.resolve(null);
            close();
          }}
        />
      );
    }
  }

  return { confirm, prompt, pick, modalNode };
};
