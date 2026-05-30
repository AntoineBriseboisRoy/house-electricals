import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus, Search, X, Zap } from 'lucide-react';
import type { Breaker, BreakerInput, Poles } from '@he/shared';
import { createBreaker, type PanelWithBreakers } from '../api.js';
import { Button, Input, Select, toast } from '../ui/index.js';
import { usePopoverPosition } from '../hooks/usePopoverPosition.js';

/**
 * 2026-05 — the component-form "Breaker" picker. Combines the searchable
 * combobox (design #1) with panel-selector pills (design #2) and an inline
 * "+ New breaker" mini-form, so a brand-new circuit can be created without
 * leaving the form:
 *
 *  ┌ pills: [Main Panel] [Garage Subpanel] ┐   ← scope the list to one panel
 *  │ search…                               │
 *  │ ▣ 14  Kitchen outlets · 15A           │   ← rich rows (slot/label/amps)
 *  │ ▣  3  Fridge · 20A          GFCI      │
 *  │ + New breaker on Main Panel           │   ← expands the inline mini-form
 *  └───────────────────────────────────────┘
 *
 * The popover is portal-mounted (escapes the modal's overflow) and
 * position-flipped like the cycle-60 Combobox. Newly-created breakers are
 * appended to a local copy of the groups and auto-selected; `onBreakerCreated`
 * lets the parent refetch if it wants. No new token NAMES.
 */

const AMPERAGE_OPTIONS = [15, 20, 30, 40, 50, 60] as const;
const POLES_OPTIONS: { value: Poles; label: string }[] = [
  { value: 'single', label: 'Single-pole' },
  { value: 'double', label: 'Double-pole (240V)' },
];

type Props = {
  /** All panels (including empty ones), from `listAllBreakersGrouped()`. */
  panels: PanelWithBreakers[];
  value: string | null;
  onChange: (breakerId: string | null) => void;
  /** Default active pill (the floor's linked panel, when known). */
  floorPanelId?: string | null;
  /** Fired after a breaker is created so the parent can refetch its data. */
  onBreakerCreated?: (breaker: Breaker, panelId: string) => void;
  testId?: string;
};

const slotLabel = (b: Breaker): string =>
  b.poles === 'tandem' && b.tandemHalf !== null
    ? `${b.slot}${b.tandemHalf}`
    : b.slot;

export const BreakerComboField = ({
  panels,
  value,
  onChange,
  floorPanelId = null,
  onBreakerCreated,
  testId = 'cf-breaker',
}: Props): JSX.Element => {
  const [groups, setGroups] = useState<PanelWithBreakers[]>(panels);
  // Re-seed when the parent passes a fresh list (e.g. after a save/refresh).
  useEffect(() => {
    setGroups(panels);
  }, [panels]);

  const allBreakers = useMemo(
    () => groups.flatMap((g) => g.breakers),
    [groups]
  );
  const selected = useMemo(
    () => (value === null ? null : allBreakers.find((b) => b.id === value) ?? null),
    [allBreakers, value]
  );

  // Active pill: the selected breaker's panel → the floor's linked panel →
  // the first panel.
  const initialPanelId = useMemo(() => {
    if (selected) {
      const g = groups.find((x) => x.breakers.some((b) => b.id === selected.id));
      if (g) return g.panel.id;
    }
    if (floorPanelId && groups.some((g) => g.panel.id === floorPanelId)) {
      return floorPanelId;
    }
    return groups[0]?.panel.id ?? null;
  }, [selected, floorPanelId, groups]);

  const [activePanelId, setActivePanelId] = useState<string | null>(initialPanelId);
  // Keep the active pill sensible if panels arrive after mount.
  useEffect(() => {
    if (activePanelId === null && initialPanelId !== null) {
      setActivePanelId(initialPanelId);
    }
  }, [activePanelId, initialPanelId]);

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Shared positioner (2026-05) — same flip/clamp logic as ui/Combobox.
  const pos = usePopoverPosition({
    isOpen,
    triggerRef,
    minWidth: 280,
    maxWidth: 420,
    flipThreshold: 280,
    minMaxHeight: 200,
  });

  const activePanel = groups.find((g) => g.panel.id === activePanelId) ?? null;
  const activeName = activePanel?.panel.name ?? 'panel';

  const filteredBreakers = useMemo(() => {
    const list = activePanel?.breakers ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (b) =>
        b.label.toLowerCase().includes(q) ||
        slotLabel(b).toLowerCase().includes(q) ||
        `${b.amperage}`.includes(q)
    );
  }, [activePanel, search]);


  // Outside-click + Escape close.
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (containerRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !creating) {
      const t = window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [isOpen, creating]);

  const close = (): void => {
    setIsOpen(false);
    setSearch('');
    setCreating(false);
  };

  const pickBreaker = (id: string): void => {
    onChange(id);
    close();
  };

  return (
    <div className="breaker-combo" ref={containerRef} data-testid={testId}>
      <button
        ref={triggerRef}
        type="button"
        id={`${testId}-trigger`}
        className="breaker-combo__trigger"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label="Breaker"
        data-testid={`${testId}-trigger`}
        onClick={() => {
          setIsOpen((o) => !o);
          setSearch('');
          setCreating(false);
        }}
      >
        {selected ? (
          <>
            <Zap size={14} strokeWidth={2.25} className="breaker-combo__zap" aria-hidden="true" />
            <span className="breaker-combo__slot">{slotLabel(selected)}</span>
            <span className="breaker-combo__trigger-label">{selected.label}</span>
            <span className="breaker-combo__trigger-sub">· {selected.amperage}A</span>
          </>
        ) : (
          <span className="breaker-combo__placeholder">Unassigned (not wired)</span>
        )}
        <span className="breaker-combo__trigger-icons">
          {value !== null && (
            <span
              role="button"
              tabIndex={-1}
              className="breaker-combo__clear"
              aria-label="Clear breaker"
              data-testid={`${testId}-clear`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
                setIsOpen(false);
              }}
            >
              <X size={12} strokeWidth={2.5} />
            </span>
          )}
          <ChevronDown
            size={14}
            strokeWidth={2.25}
            className={
              isOpen
                ? 'breaker-combo__chevron breaker-combo__chevron--open'
                : 'breaker-combo__chevron'
            }
          />
        </span>
      </button>

      {isOpen &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            data-portal-popover="true"
            data-testid={`${testId}-popover`}
            className="breaker-combo__popover"
            style={{
              position: 'fixed',
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              zIndex: 9999,
            }}
          >
            {/* Panel pills — scope the list (design #2). */}
            {groups.length > 1 && (
              <div className="breaker-combo__pills" role="tablist" aria-label="Panel">
                {groups.map((g) => (
                  <button
                    key={g.panel.id}
                    type="button"
                    role="tab"
                    className="breaker-combo__pill"
                    aria-selected={g.panel.id === activePanelId}
                    data-testid="breaker-combo-pill"
                    data-panel-id={g.panel.id}
                    onClick={() => {
                      setActivePanelId(g.panel.id);
                      setCreating(false);
                      setSearch('');
                    }}
                  >
                    {g.panel.name}
                  </button>
                ))}
              </div>
            )}

            {creating ? (
              <BreakerMiniForm
                panelName={activeName}
                suggestedSlot={nextFreeSlot(activePanel)}
                onCancel={() => setCreating(false)}
                onCreate={async (input) => {
                  if (activePanelId === null) return;
                  const breaker = await createBreaker(activePanelId, input);
                  setGroups((prev) =>
                    prev.map((g) =>
                      g.panel.id === activePanelId
                        ? { ...g, breakers: [...g.breakers, breaker] }
                        : g
                    )
                  );
                  onBreakerCreated?.(breaker, activePanelId);
                  onChange(breaker.id);
                  close();
                }}
              />
            ) : (
              <>
                <div className="breaker-combo__search-wrap">
                  <Search size={12} strokeWidth={2.25} aria-hidden="true" />
                  <input
                    ref={searchRef}
                    type="text"
                    className="breaker-combo__search"
                    placeholder="Search breakers…"
                    aria-label="Search breakers"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="breaker-combo__list" role="listbox">
                  {filteredBreakers.length === 0 ? (
                    <p className="breaker-combo__empty">
                      {(activePanel?.breakers.length ?? 0) === 0
                        ? 'No breakers on this panel yet.'
                        : 'No breakers match your search.'}
                    </p>
                  ) : (
                    filteredBreakers.map((b) => {
                      const isSel = b.id === value;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          role="option"
                          aria-selected={isSel}
                          data-testid="breaker-combo-option"
                          data-breaker-id={b.id}
                          className={
                            isSel
                              ? 'breaker-combo__option breaker-combo__option--selected'
                              : 'breaker-combo__option'
                          }
                          onClick={() => pickBreaker(b.id)}
                        >
                          <span className="breaker-combo__opt-slot">
                            {slotLabel(b)}
                          </span>
                          <span className="breaker-combo__opt-text">
                            <span className="breaker-combo__opt-label">
                              {b.label}
                            </span>
                            <span className="breaker-combo__opt-sub">
                              {b.amperage}A
                              {b.poles === 'double' ? ' · 2-pole' : ''}
                            </span>
                          </span>
                          {b.protection !== null && (
                            <span className="breaker-combo__opt-prot">
                              {b.protection.toUpperCase()}
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
                {activePanelId !== null && (
                  <button
                    type="button"
                    className="breaker-combo__add"
                    data-testid="breaker-combo-add"
                    onClick={() => setCreating(true)}
                  >
                    <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
                    New breaker on {activeName}
                  </button>
                )}
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};

/** Suggest the next free numeric slot for a panel (max + 1, else 1). */
const nextFreeSlot = (panel: PanelWithBreakers | null): string => {
  if (!panel || panel.breakers.length === 0) return '1';
  let max = 0;
  for (const b of panel.breakers) {
    const n = b.slotPosition ?? Number.parseInt(b.slot, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
};

type MiniProps = {
  panelName: string;
  suggestedSlot: string;
  onCreate: (input: BreakerInput) => Promise<void>;
  onCancel: () => void;
};

const BreakerMiniForm = ({
  panelName,
  suggestedSlot,
  onCreate,
  onCancel,
}: MiniProps): JSX.Element => {
  const [slot, setSlot] = useState(suggestedSlot);
  const [amperage, setAmperage] = useState(15);
  const [poles, setPoles] = useState<Poles>('single');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const trimmedSlot = slot.trim();
    if (trimmedSlot === '') {
      setError('Slot is required.');
      return;
    }
    setBusy(true);
    setError(null);
    const parsed = Number.parseInt(trimmedSlot, 10);
    const input: BreakerInput = {
      slot: trimmedSlot,
      slotPosition: Number.isFinite(parsed) ? parsed : null,
      amperage,
      poles,
      label: label.trim() === '' ? `Slot ${trimmedSlot}` : label.trim(),
      tandemHalf: null,
      protection: null,
    };
    try {
      await onCreate(input);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create breaker.');
      toast.error(e instanceof Error ? e.message : 'Failed to create breaker.');
      setBusy(false);
    }
  };

  return (
    <div className="breaker-combo__mini" data-testid="breaker-combo-mini">
      <h4 className="breaker-combo__mini-title">
        <Plus size={13} strokeWidth={2.5} aria-hidden="true" /> New breaker on{' '}
        {panelName}
      </h4>
      <div className="breaker-combo__mini-grid">
        <Input
          label="Slot"
          type="text"
          inputMode="numeric"
          value={slot}
          data-testid="breaker-combo-mini-slot"
          error={error}
          onChange={(e) => setSlot(e.target.value)}
        />
        <Select<string>
          label="Amperage"
          value={String(amperage)}
          data-testid="breaker-combo-mini-amperage"
          options={AMPERAGE_OPTIONS.map((a) => ({
            value: String(a),
            label: `${a} A`,
          }))}
          onChange={(next) => setAmperage(Number(next ?? 15))}
        />
        <Select<Poles>
          label="Poles"
          value={poles}
          data-testid="breaker-combo-mini-poles"
          options={POLES_OPTIONS}
          onChange={(next) => setPoles(next ?? 'single')}
        />
        <Input
          label="Label (optional)"
          type="text"
          value={label}
          placeholder={`Slot ${slot.trim() || '?'}`}
          data-testid="breaker-combo-mini-label"
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className="breaker-combo__mini-actions">
        <Button
          type="button"
          variant="primary"
          busy={busy}
          disabled={busy}
          leadingIcon={<Plus size={16} strokeWidth={2.5} />}
          data-testid="breaker-combo-mini-create"
          onClick={() => {
            void submit();
          }}
        >
          {busy ? 'Creating…' : 'Create & select'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
};
