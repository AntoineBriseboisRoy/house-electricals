import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { CircuitBoard, ClipboardList } from 'lucide-react';
import type { Panel } from '@he/shared';
import {
  latestBreakerTestsByIds,
  listAllBreakersGrouped,
  type PanelWithBreakers,
} from '../api.js';
import { formatRelative } from '../lib/relativeTime.js';
import {
  Button,
  Card,
  EmptyState,
  NoPanels,
  ScreenHeader,
  Skeleton,
  toast,
} from '../ui/index.js';

/**
 * Test tab home (Refactor 2026-05).
 *
 * The Test tab's landing screen. Lists the house's panels with a "Walk
 * through" CTA per panel, plus an always-visible audit-log link.
 *
 * Renders the same list regardless of panel count — even with one panel,
 * the picker surfaces the audit-log link as a sibling choice, so it has
 * value as a tab home. Don't auto-redirect: that would conflict with the
 * Back button on the walk-through (which lands here).
 */
type PanelMeta = {
  panel: Panel;
  breakerCount: number;
  /** epoch ms of the latest test across this panel's breakers; null = never */
  latestTestedAt: number | null;
};

export const TestHomeScreen = (): JSX.Element => {
  const [, setLocation] = useLocation();
  const [rows, setRows] = useState<PanelMeta[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const groups: PanelWithBreakers[] = await listAllBreakersGrouped();
        if (cancelled) return;
        const allBreakerIds = groups.flatMap((g) =>
          g.breakers.map((b) => b.id)
        );
        const latestByBreakerId = await latestBreakerTestsByIds(allBreakerIds);
        if (cancelled) return;
        const next: PanelMeta[] = groups.map((g) => {
          let latest: number | null = null;
          for (const b of g.breakers) {
            const t = latestByBreakerId.get(b.id);
            if (t && (latest === null || t.testedAt > latest)) {
              latest = t.testedAt;
            }
          }
          return {
            panel: g.panel,
            breakerCount: g.breakers.length,
            latestTestedAt: latest,
          };
        });
        setRows(next);
      } catch (e) {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : 'Failed to load panels.');
        setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <ScreenHeader
        title="Test"
        subtitle="Walk through a panel to verify each breaker controls what it should."
      />

      {rows === null ? (
        <Skeleton variant="row" count={3} />
      ) : rows.length === 0 ? (
        <EmptyState
          illustration={<NoPanels />}
          title="No panels yet"
          description="Create a panel before running a walk-through."
          action={
            <Button variant="primary" onClick={() => setLocation('/')}>
              Go to Panels
            </Button>
          }
        />
      ) : (
        <ul className="test-home__list" data-testid="test-home-list">
          {rows.map(({ panel: p, breakerCount, latestTestedAt }) => {
            const verifiedCopy =
              latestTestedAt === null
                ? 'Never verified'
                : `Last verified ${formatRelative(latestTestedAt)}`;
            return (
              <li key={p.id}>
                <Link
                  href={`/test/${p.id}`}
                  className="test-home__row"
                  data-testid="test-home-row"
                  data-panel-id={p.id}
                >
                  <span className="test-home__row-icon" aria-hidden="true">
                    <CircuitBoard size={20} strokeWidth={2.25} />
                  </span>
                  <span className="test-home__row-body">
                    <span className="test-home__row-name">{p.name}</span>
                    <span className="test-home__row-meta">
                      {breakerCount}{' '}
                      {breakerCount === 1 ? 'breaker' : 'breakers'} ·{' '}
                      {verifiedCopy}
                    </span>
                  </span>
                  <span className="test-home__row-cta">Walk through →</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Card>
        <Link
          href="/test/audit"
          className="test-home__audit-link"
          data-testid="test-home-audit-link"
        >
          <ClipboardList size={18} strokeWidth={2.25} aria-hidden="true" />
          <span>View audit log</span>
          <span className="muted">— every verified test, every panel</span>
        </Link>
      </Card>
    </>
  );
};
