import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ClipboardList, Power, PowerOff, Search } from 'lucide-react';
import type { BreakerStateEvent, BreakerTest } from '@he/shared';
import {
  listBreakerTests,
  listBreakerStateEvents,
  listAllBreakersGrouped,
  type PanelWithBreakers,
} from '../api.js';
import {
  Button,
  Card,
  CardTitle,
  Combobox,
  EmptyState,
  FilterPopover,
  FilterTriggerButton,
  Input,
  ScreenHeader,
  Skeleton,
  SortDropdown,
  toast,
  type SortOption,
} from '../ui/index.js';
import { useFilterPopover } from '../hooks/useFilterPopover.js';
import { useFilterState } from '../hooks/useFilterState.js';
import { formatRelative } from '../lib/relativeTime.js';
import {
  dateInputValue,
  epochFromDateInputEnd,
  epochFromDateInputStart,
  formatDateTime,
} from '../lib/datetime.js';

/**
 * G36 Part 2 (cycle-63) — house-level audit log for breaker tests.
 *
 * Pinned decisions (see CLAUDE.md "Audit screen (G36 Part 2 — cycle-63)"):
 *  - Route is /audit (FLAT, NOT panel-scoped) and AppShell-wrapped.
 *  - Server caps GET /api/v1/breaker-tests to LIMIT 200; response shape
 *    is { data, totalCount } so we can render "Showing N of M" hints.
 *  - Filter state is persisted under localStorage key `he.audit-filter`.
 *  - Date range is native <input type="date"> (no date-fns/dayjs).
 *  - Outcome filter is a typeahead Combobox of distinct loaded outcomes
 *    (mirrors ComponentsScreen Room pattern).
 *  - Click-through deep-link reuses cycle-22/23 contract:
 *      /panels/<panelId>#breaker-<breakerId>
 *  - No 4th bottom-tab; entry is via TestPanelScreen footer link.
 *  - GETs stay NetworkFirst (NOT added to SWR allowlist).
 */

type SortBy = 'testedAt' | 'outcome';
type SortOrder = 'asc' | 'desc';

type AuditFilterState = {
  since: number | null;
  until: number | null;
  outcome: string | null;
  breakerId: string | null;
  sortBy: SortBy;
  sortOrder: SortOrder;
};

const FILTER_STORAGE_KEY = 'he.audit-filter';

const FILTER_DEFAULTS: AuditFilterState = {
  since: null,
  until: null,
  outcome: null,
  breakerId: null,
  sortBy: 'testedAt',
  sortOrder: 'desc',
};

const SORT_OPTIONS: readonly SortOption<SortBy>[] = [
  { sortBy: 'testedAt', sortOrder: 'desc', label: 'Newest first' },
  { sortBy: 'testedAt', sortOrder: 'asc', label: 'Oldest first' },
  { sortBy: 'outcome', sortOrder: 'asc', label: 'Outcome (A→Z)' },
  { sortBy: 'outcome', sortOrder: 'desc', label: 'Outcome (Z→A)' },
];

/** Native date-input value is `yyyy-mm-dd`. We convert at submit to epoch ms
 *  and round-trip back to the input — both sides interpret the day in the
 *  app's configured timezone (the `TZ` env var; device-local when unset). So a
 *  "since 2024-01-01" filter means "rows on or after midnight 2024-01-01 in the
 *  app zone". See lib/datetime.ts. */
const dateInputFromEpoch = dateInputValue;
const epochFromSinceInput = epochFromDateInputStart;
/** `until` is inclusive — end-of-day so "until 2024-01-31" includes 23:59. */
const epochFromUntilInput = epochFromDateInputEnd;
const absoluteDate = (epochMs: number): string => formatDateTime(epochMs);

const sortTests = (
  list: readonly BreakerTest[],
  sortBy: SortBy,
  sortOrder: SortOrder
): BreakerTest[] => {
  const dir = sortOrder === 'asc' ? 1 : -1;
  const copy = [...list];
  copy.sort((a, b) => {
    if (sortBy === 'outcome') {
      const ao = a.outcome ?? '';
      const bo = b.outcome ?? '';
      if (ao === '' && bo === '') {
        // Stable tiebreaker: testedAt DESC regardless of sort dir.
        return b.testedAt - a.testedAt;
      }
      if (ao === '') return 1; // null outcomes sort last
      if (bo === '') return -1;
      const cmp = ao.localeCompare(bo) * dir;
      if (cmp !== 0) return cmp;
      return b.testedAt - a.testedAt;
    }
    // sortBy === 'testedAt' — fall back to id when timestamps tie.
    if (a.testedAt !== b.testedAt) return (a.testedAt - b.testedAt) * dir;
    return a.id.localeCompare(b.id) * dir;
  });
  return copy;
};

type BreakerSummary = {
  id: string;
  panelId: string;
  panelName: string;
  slot: string;
  slotPosition: number | null;
  label: string;
  amperage: number;
  tandemHalf: 'a' | 'b' | null;
};

type BreakerLookup = Map<string, BreakerSummary>;

const buildBreakerLookup = (groups: PanelWithBreakers[]): BreakerLookup => {
  const map: BreakerLookup = new Map();
  for (const { panel, breakers } of groups) {
    for (const b of breakers) {
      map.set(b.id, {
        id: b.id,
        panelId: panel.id,
        panelName: panel.name,
        slot: b.slot,
        slotPosition: b.slotPosition,
        label: b.label,
        amperage: b.amperage,
        tandemHalf: b.tandemHalf,
      });
    }
  }
  return map;
};

const formatBreakerLabel = (b: BreakerSummary | undefined): string => {
  if (!b) return '(unknown breaker)';
  const slot = `slot ${b.slot}${b.tandemHalf ?? ''}`;
  return `${b.panelName} · ${slot} · ${b.label}`;
};

/** Cycle-65 P1 — outcome semantic color heuristic. Outcomes are free text
 *  (cycle-61 ADR rule 2: NOT an enum), so we substring-match on common bad
 *  keywords to surface warning visuals. Anything matching → warn (amber);
 *  everything else (including the canonical "OK") → success (sage). */
const BAD_OUTCOME_PATTERN = /(trip|trips|fault|fail|blow|error|bad)/i;
const outcomeFlavor = (outcome: string): 'warn' | 'success' => {
  return BAD_OUTCOME_PATTERN.test(outcome) ? 'warn' : 'success';
};

export const AuditScreen = (): JSX.Element => {
  // Refactor 2026-05 iter-4 — show a back-arrow to /test when entered via
  // the canonical /test/audit nested route. Legacy /audit (no parent path)
  // keeps the title-only header.
  const [location] = useLocation();
  const cameFromTestTab = location.startsWith('/test/');
  const [tests, setTests] = useState<BreakerTest[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  /** 2026-05 — breaker on/off state-change events (the dedicated audit). */
  const [stateEvents, setStateEvents] = useState<BreakerStateEvent[]>([]);
  const [breakerGroups, setBreakerGroups] = useState<PanelWithBreakers[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [filterState, setFilterState] = useFilterState<AuditFilterState>(
    FILTER_STORAGE_KEY,
    FILTER_DEFAULTS
  );
  const { since, until, outcome, breakerId, sortBy, sortOrder } = filterState;
  const filterPopover = useFilterPopover();

  // Debounced search → committed `search` (case-insensitive substring over
  // BreakerTest.notes, client-side). 250ms to match ComponentsScreen.
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearch(searchInput.trim());
    }, 250);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchInput]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const filter: Parameters<typeof listBreakerTests>[0] = {};
      if (since !== null) filter.since = since;
      if (until !== null) filter.until = until;
      if (outcome !== null && outcome.length > 0) filter.outcome = outcome;
      if (breakerId !== null) filter.breakerId = breakerId;
      // The on/off audit shares the breaker + date filters (no outcome — state
      // events have none). Panel attribution rides along via the breaker label.
      const stateFilter: Parameters<typeof listBreakerStateEvents>[0] = {};
      if (since !== null) stateFilter.since = since;
      if (until !== null) stateFilter.until = until;
      if (breakerId !== null) stateFilter.breakerId = breakerId;
      const [result, stateResult, groups] = await Promise.all([
        listBreakerTests(filter),
        listBreakerStateEvents(stateFilter),
        listAllBreakersGrouped(),
      ]);
      setTests(result.data);
      setTotalCount(result.totalCount);
      setStateEvents(stateResult.data);
      setBreakerGroups(groups);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load audit log.');
    } finally {
      setLoading(false);
    }
  }, [since, until, outcome, breakerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const breakerLookup = useMemo(
    () => buildBreakerLookup(breakerGroups),
    [breakerGroups]
  );

  // Breaker options — all known breakers in the house.
  const breakerOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    for (const { panel, breakers } of breakerGroups) {
      for (const b of breakers) {
        const slot = `slot ${b.slot}${b.tandemHalf ?? ''}`;
        opts.push({
          value: b.id,
          label: `${panel.name} · ${slot} · ${b.label}`,
        });
      }
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label));
  }, [breakerGroups]);

  // Outcome options — distinct non-null/non-empty values from loaded tests.
  // Mirrors the ComponentsScreen "room" Combobox pattern. Falls back to a
  // disabled state when there are none.
  const outcomeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of tests) {
      if (t.outcome !== null && t.outcome.trim().length > 0) {
        set.add(t.outcome);
      }
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((o) => ({ value: o, label: o }));
  }, [tests]);

  const filteredTests = useMemo(() => {
    if (search.length === 0) return tests;
    const lower = search.toLowerCase();
    return tests.filter((t) => {
      const notesMatch =
        t.notes !== null && t.notes.toLowerCase().includes(lower);
      const outcomeMatch =
        t.outcome !== null && t.outcome.toLowerCase().includes(lower);
      return notesMatch || outcomeMatch;
    });
  }, [tests, search]);

  const visibleTests = useMemo(
    () => sortTests(filteredTests, sortBy, sortOrder),
    [filteredTests, sortBy, sortOrder]
  );

  // On/off events come pre-sorted (occurred_at DESC) from the server. Apply the
  // same free-text search over their note for consistency with the test list.
  const visibleStateEvents = useMemo(() => {
    if (search.length === 0) return stateEvents;
    const lower = search.toLowerCase();
    return stateEvents.filter(
      (ev) => ev.note !== null && ev.note.toLowerCase().includes(lower)
    );
  }, [stateEvents, search]);

  const activeFilterCount =
    (since !== null ? 1 : 0) +
    (until !== null ? 1 : 0) +
    (outcome !== null ? 1 : 0) +
    (breakerId !== null ? 1 : 0);
  const hasAnyFilter = activeFilterCount > 0 || searchInput.trim() !== '';

  const clearFilters = useCallback((): void => {
    setSearchInput('');
    setFilterState(FILTER_DEFAULTS);
  }, [setFilterState]);

  return (
    <>
      <ScreenHeader
        title="Audit log"
        subtitle="Breaker tests + on/off changes"
        back={cameFromTestTab ? '/test' : undefined}
      />

      <Card>
        <CardTitle className="visually-hidden">Search</CardTitle>
        <Input
          label={null}
          aria-label="Search audit log"
          type="search"
          inputMode="search"
          placeholder="Search notes or outcome…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          autoComplete="off"
          leadingIcon={<Search size={16} strokeWidth={2.25} />}
          data-testid="audit-search"
        />
        <div className="filter-toolbar" data-testid="audit-filter-toolbar">
          <FilterTriggerButton
            ref={filterPopover.buttonRef}
            label="Filter"
            count={activeFilterCount}
            active={activeFilterCount > 0}
            onClick={filterPopover.toggle}
            testId="audit-filter-trigger"
            ariaLabel="Filter audit log"
          />
          <SortDropdown<SortBy>
            options={SORT_OPTIONS}
            currentSortBy={sortBy}
            currentSortOrder={sortOrder}
            onSort={(nextBy, nextOrder) =>
              setFilterState((prev) => ({
                ...prev,
                sortBy: nextBy,
                sortOrder: nextOrder,
              }))
            }
            testId="audit-sort"
          />
          {hasAnyFilter && (
            // Cycle-70 polish-pass-2 P2 #14 — was variant="ghost" (bare
            // text). Secondary variant matches the FilterTriggerButton
            // pill aesthetic for sibling-consistency on the toolbar.
            <Button
              variant="secondary"
              size="sm"
              onClick={clearFilters}
              data-testid="audit-filter-clear"
            >
              Clear filters
            </Button>
          )}
        </div>
      </Card>

      <FilterPopover
        isOpen={filterPopover.isOpen}
        popoverRef={filterPopover.popoverRef}
        position={filterPopover.position}
        ariaLabel="Audit log filters"
        testId="audit-filter-popover"
      >
        <div className="filter-popover__section">
          <h3 className="filter-popover__section-title">Date range</h3>
          <div className="audit-date-range">
            <label className="audit-date-range__field">
              <span className="audit-date-range__label">Since</span>
              <input
                type="date"
                value={dateInputFromEpoch(since)}
                onChange={(e) =>
                  setFilterState((prev) => ({
                    ...prev,
                    since: epochFromSinceInput(e.target.value),
                  }))
                }
                data-testid="audit-filter-since"
                className="audit-date-range__input"
              />
            </label>
            <label className="audit-date-range__field">
              <span className="audit-date-range__label">Until</span>
              <input
                type="date"
                value={dateInputFromEpoch(until)}
                onChange={(e) =>
                  setFilterState((prev) => ({
                    ...prev,
                    until: epochFromUntilInput(e.target.value),
                  }))
                }
                data-testid="audit-filter-until"
                className="audit-date-range__input"
              />
            </label>
          </div>
        </div>

        <div className="filter-popover__section">
          <h3 className="filter-popover__section-title">Outcome</h3>
          <Combobox<string>
            value={outcome}
            onChange={(next) =>
              setFilterState((prev) => ({ ...prev, outcome: next }))
            }
            options={outcomeOptions}
            placeholder={
              outcomeOptions.length === 0
                ? 'No outcomes recorded yet'
                : 'Any outcome'
            }
            ariaLabel="Filter by outcome"
            testId="audit-filter-outcome"
            emptyMessage="No matching outcomes"
            disabled={outcomeOptions.length === 0}
          />
        </div>

        <div className="filter-popover__section">
          <h3 className="filter-popover__section-title">Breaker</h3>
          <Combobox<string>
            value={breakerId}
            onChange={(next) =>
              setFilterState((prev) => ({ ...prev, breakerId: next }))
            }
            options={breakerOptions}
            placeholder={
              breakerOptions.length === 0 ? 'No breakers yet' : 'Any breaker'
            }
            ariaLabel="Filter by breaker"
            testId="audit-filter-breaker"
            emptyMessage="No matching breakers"
            disabled={breakerOptions.length === 0}
          />
        </div>

        <div className="filter-popover__footer">
          {/* Cycle-70 polish-pass-2 P2 #14 — was variant="ghost". Secondary
              gives a clear button shape next to the primary "Done", so the
              two footer actions read as a real button pair instead of a
              text-link + button. */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setFilterState((prev) => ({
                ...prev,
                since: null,
                until: null,
                outcome: null,
                breakerId: null,
              }));
            }}
            disabled={activeFilterCount === 0}
            data-testid="audit-filter-popover-clear"
          >
            Clear
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={filterPopover.close}
            data-testid="audit-filter-popover-done"
          >
            Done
          </Button>
        </div>
      </FilterPopover>

      <section aria-labelledby="audit-heading" className="section">
        <h2 id="audit-heading" className="section-title">
          Tests
        </h2>
        {/* G36 Part 2 cycle-63 — "Showing N of M" hint when the server
            LIMIT was hit. Filter to see older entries (no cursor paging). */}
        {!loading && totalCount > tests.length && (
          <p
            className="audit-overflow-hint"
            data-testid="audit-overflow-hint"
          >
            Showing the most-recent {tests.length} of {totalCount} tests.
            Filter to see older entries.
          </p>
        )}

        {loading ? (
          <Skeleton variant="row" count={5} aria-label="Loading audit log" />
        ) : visibleTests.length === 0 ? (
          hasAnyFilter ? (
            // EmptyState lucide-icon: filtered-empty branch (cycle-76 ADR — first-impression illustrations only)
            <EmptyState
              icon={<ClipboardList size={32} strokeWidth={1.5} />}
              title="No tests match your filters"
              description="Try clearing the filters to see the full log."
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            // EmptyState lucide-icon: ClipboardList semantically conveys log/history; defer bespoke NoAuditTests illustration (cycle-77 Lockin #2 — zero new art this cycle)
            <EmptyState
              icon={<ClipboardList size={32} strokeWidth={1.5} />}
              title="No tests recorded yet"
              description="Mark a breaker verified in the Test mode to start tracking history."
            />
          )
        ) : (
          <ul className="audit-list">
            {visibleTests.map((t) => {
              const b = breakerLookup.get(t.breakerId);
              const href =
                b !== undefined
                  ? `/panels/${b.panelId}#breaker-${b.id}`
                  : null;
              const row = (
                <>
                  <div className="audit-row__primary">
                    <span className="audit-row__date">
                      {absoluteDate(t.testedAt)}
                    </span>
                    <span className="audit-row__relative muted">
                      ({formatRelative(t.testedAt)})
                    </span>
                  </div>
                  <div className="audit-row__breaker">
                    {formatBreakerLabel(b)}
                  </div>
                  <div className="audit-row__meta">
                    {t.outcome !== null && t.outcome.length > 0 && (
                      <span
                        className={
                          'badge audit-row__outcome audit-row__outcome--' +
                          outcomeFlavor(t.outcome)
                        }
                        data-testid="audit-row-outcome"
                        data-outcome-flavor={outcomeFlavor(t.outcome)}
                      >
                        {t.outcome}
                      </span>
                    )}
                    {t.notes !== null && t.notes.length > 0 && (
                      <span className="audit-row__notes" title={t.notes}>
                        {t.notes}
                      </span>
                    )}
                  </div>
                </>
              );
              return (
                <li
                  key={t.id}
                  className="audit-row"
                  data-testid="audit-row"
                  data-breaker-id={t.breakerId}
                  data-test-id={t.id}
                >
                  {href !== null ? (
                    <Link
                      href={href}
                      className="audit-row__link"
                      aria-label={`Open ${formatBreakerLabel(b)} on its panel`}
                      data-testid="audit-row-link"
                    >
                      {row}
                    </Link>
                  ) : (
                    <div className="audit-row__link audit-row__link--disabled">
                      {row}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 2026-05 — breaker on/off state-change log (the dedicated audit table).
          Shares the breaker + date filters; the breaker label carries panel
          attribution. Deep-links to the panel slot like the test rows. */}
      <section aria-labelledby="audit-state-heading" className="section">
        <h2 id="audit-state-heading" className="section-title">
          On/off changes
        </h2>
        {loading ? (
          <Skeleton variant="row" count={3} aria-label="Loading on/off log" />
        ) : visibleStateEvents.length === 0 ? (
          <EmptyState
            icon={<Power size={32} strokeWidth={1.5} />}
            title={
              hasAnyFilter
                ? 'No on/off changes match your filters'
                : 'No on/off changes yet'
            }
            description={
              hasAnyFilter
                ? 'Try clearing the filters to see the full log.'
                : 'Turning a breaker on or off records an entry here.'
            }
          />
        ) : (
          <ul className="audit-list" data-testid="audit-state-list">
            {visibleStateEvents.map((ev) => {
              const b = breakerLookup.get(ev.breakerId);
              const href =
                b !== undefined
                  ? `/panels/${b.panelId}#breaker-${b.id}`
                  : null;
              const row = (
                <>
                  <div className="audit-row__primary">
                    <span className="audit-row__date">
                      {absoluteDate(ev.occurredAt)}
                    </span>
                    <span className="audit-row__relative muted">
                      ({formatRelative(ev.occurredAt)})
                    </span>
                  </div>
                  <div className="audit-row__breaker">{formatBreakerLabel(b)}</div>
                  <div className="audit-row__meta">
                    <span
                      className={
                        'badge audit-row__outcome audit-row__outcome--' +
                        (ev.isOn ? 'success' : 'warn')
                      }
                      data-testid="audit-state-row-action"
                      data-is-on={ev.isOn ? 'true' : 'false'}
                    >
                      {ev.isOn ? (
                        <Power size={11} strokeWidth={2.5} aria-hidden="true" />
                      ) : (
                        <PowerOff size={11} strokeWidth={2.5} aria-hidden="true" />
                      )}
                      {ev.isOn ? 'Turned on' : 'Turned off'}
                    </span>
                    {ev.note !== null && ev.note.length > 0 && (
                      <span className="audit-row__notes" title={ev.note}>
                        {ev.note}
                      </span>
                    )}
                  </div>
                </>
              );
              return (
                <li
                  key={ev.id}
                  className="audit-row"
                  data-testid="audit-state-row"
                  data-breaker-id={ev.breakerId}
                  data-panel-id={ev.panelId}
                >
                  {href !== null ? (
                    <Link
                      href={href}
                      className="audit-row__link"
                      aria-label={`Open ${formatBreakerLabel(b)} on its panel`}
                    >
                      {row}
                    </Link>
                  ) : (
                    <div className="audit-row__link audit-row__link--disabled">
                      {row}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
};
