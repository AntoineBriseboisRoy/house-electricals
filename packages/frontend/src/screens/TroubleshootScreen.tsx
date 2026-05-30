import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  Search,
  Zap,
  ChevronRight,
  AlertTriangle,
  ShieldCheck,
  ToggleLeft,
  Gauge,
  CornerDownRight,
  Lightbulb,
  Plug,
  CircleDot,
  Wrench,
  ArrowLeft,
  ShieldAlert,
} from 'lucide-react';
import { ScreenHeader } from '../ui/ScreenHeader.js';
import { Card, Input, Button } from '../ui/index.js';
import { EmptyState } from '../ui/EmptyState.js';
import { Spinner } from '../ui/Spinner.js';
import { ProtectionBadge } from '../components/ProtectionBadge.js';
import {
  listComponents,
  listAllBreakersGrouped,
  listSwitchControlsByBuilding,
} from '../api.js';
import type { Breaker, Component, Panel, SwitchControl } from '@he/shared';
import {
  diagnose,
  breakerHref,
  type TroubleshootStepKind,
} from '../lib/troubleshoot.js';
import { useBuilding } from '../contexts/BuildingContext.js';

/**
 * Guided troubleshooting — the "something here has no power" flow.
 *
 * Pick the dead device → the screen traces its circuit (the reverse of the
 * Impact view) and lays out an ordered, plain-language checklist: GFCI reset,
 * the controlling switch, the breaker (deep-linked), upstream subpanel feeders,
 * an overload warning, and local-vs-whole-circuit reasoning. Pure-read: it
 * assembles existing list endpoints + the `diagnose` helper. No new backend.
 */

type TData = {
  components: Component[];
  panels: Panel[];
  breakersByPanel: Map<string, Breaker[]>;
  switchControls: SwitchControl[];
};

const typeIcon = (type: Component['type']): JSX.Element => {
  switch (type) {
    case 'light':
      return <Lightbulb size={18} />;
    case 'switch':
      return <ToggleLeft size={18} />;
    case 'outlet':
    case 'appliance':
      return <Plug size={18} />;
    default:
      return <CircleDot size={18} />;
  }
};

const STEP_ICON: Record<TroubleshootStepKind, JSX.Element> = {
  unwired: <AlertTriangle size={18} />,
  safety: <ShieldAlert size={18} />,
  gfci: <ShieldCheck size={18} />,
  afci: <ShieldCheck size={18} />,
  switch: <ToggleLeft size={18} />,
  breaker: <Zap size={18} />,
  feeder: <CornerDownRight size={18} />,
  overload: <Gauge size={18} />,
  isolate: <Wrench size={18} />,
};

export const TroubleshootScreen = (): JSX.Element => {
  const { currentBuilding } = useBuilding();
  const [data, setData] = useState<TData | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const run = async (): Promise<void> => {
      setLoading(true);
      const [components, groups, switchControls] = await Promise.all([
        listComponents(),
        listAllBreakersGrouped(),
        listSwitchControlsByBuilding(),
      ]);
      if (!alive) return;
      const panels = groups.map((g) => g.panel);
      const breakersByPanel = new Map<string, Breaker[]>();
      for (const g of groups) breakersByPanel.set(g.panel.id, g.breakers);
      setData({ components, panels, breakersByPanel, switchControls });
      setSelectedId(null);
      setQuery('');
      setLoading(false);
    };
    void run();
    return () => {
      alive = false;
    };
  }, [currentBuilding?.id]);

  const selected = useMemo(
    () =>
      data !== null && selectedId !== null
        ? data.components.find((c) => c.id === selectedId) ?? null
        : null,
    [data, selectedId],
  );

  return (
    <div className="screen">
      <ScreenHeader title="Troubleshoot" subtitle={currentBuilding?.name} back="/test" />
      {loading || data === null ? (
        <div className="troubleshoot__loading">
          <Spinner label="Loading devices…" />
        </div>
      ) : data.components.length === 0 ? (
        <EmptyState
          icon={<Zap size={28} />}
          title="No devices yet"
          description="Add outlets, lights, and switches in the Library, then come back to troubleshoot what isn’t working."
        />
      ) : selected === null ? (
        <DevicePicker
          data={data}
          query={query}
          onQuery={setQuery}
          onSelect={setSelectedId}
        />
      ) : (
        <DiagnosisView data={data} component={selected} onReset={() => setSelectedId(null)} />
      )}
    </div>
  );
};

// ── device picker ─────────────────────────────────────────────────────────

const DevicePicker = ({
  data,
  query,
  onQuery,
  onSelect,
}: {
  data: TData;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
}): JSX.Element => {
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const list = data.components.filter((c) => {
      if (q.length === 0) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.room ?? '').toLowerCase().includes(q)
      );
    });
    const groups = new Map<string, Component[]>();
    for (const c of list) {
      const key = c.room ?? 'No room';
      const arr = groups.get(key) ?? [];
      arr.push(c);
      groups.set(key, arr);
    }
    return [...groups.entries()]
      .map(([room, comps]) => ({
        room,
        comps: comps.slice().sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.room.localeCompare(b.room));
  }, [data.components, q]);

  const total = filtered.reduce((n, g) => n + g.comps.length, 0);

  return (
    <div className="troubleshoot">
      <p className="troubleshoot__intro">
        Pick the device that has no power and we’ll trace its circuit and tell
        you what to check.
      </p>
      <div className="troubleshoot__search">
        <Search size={16} className="troubleshoot__search-icon" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search devices by name or room…"
          aria-label="Search devices"
          data-testid="troubleshoot-search"
        />
      </div>
      {total === 0 ? (
        <p className="troubleshoot__empty">No devices match “{query}”.</p>
      ) : (
        <div className="troubleshoot__groups">
          {filtered.map((g) => (
            <div key={g.room} className="troubleshoot__group">
              <h2 className="troubleshoot__group-title">{g.room}</h2>
              <ul className="troubleshoot__device-list">
                {g.comps.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="troubleshoot__device"
                      data-testid="troubleshoot-device"
                      data-component-id={c.id}
                      onClick={() => onSelect(c.id)}
                    >
                      <span className="troubleshoot__device-icon">
                        {typeIcon(c.type)}
                      </span>
                      <span className="troubleshoot__device-body">
                        <span className="troubleshoot__device-name">{c.name}</span>
                        <span className="troubleshoot__device-meta">
                          {c.breakerId === null ? 'Not wired' : c.type}
                        </span>
                      </span>
                      <ChevronRight size={18} className="troubleshoot__device-chev" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── diagnosis ───────────────────────────────────────────────────────────────

const DiagnosisView = ({
  data,
  component,
  onReset,
}: {
  data: TData;
  component: Component;
  onReset: () => void;
}): JSX.Element => {
  const d = useMemo(
    () =>
      diagnose({
        component,
        allComponents: data.components,
        allPanels: data.panels,
        breakersByPanel: data.breakersByPanel,
        switchControls: data.switchControls,
      }),
    [component, data],
  );

  return (
    <div className="troubleshoot" data-testid="troubleshoot-diagnosis">
      <button
        type="button"
        className="troubleshoot__back"
        data-testid="troubleshoot-reset"
        onClick={onReset}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        <span>Choose a different device</span>
      </button>

      <Card className="troubleshoot__summary">
        <div className="troubleshoot__summary-head">
          <span className="troubleshoot__device-icon">{typeIcon(component.type)}</span>
          <div>
            <h2 className="troubleshoot__summary-name">{component.name}</h2>
            <p className="troubleshoot__summary-sub">
              {component.room ?? 'No room'} · {component.type}
            </p>
          </div>
        </div>
        {d.breaker !== null && d.panel !== null ? (
          <Link
            href={breakerHref(d.panel.id, d.breaker.id)}
            className="troubleshoot__circuit"
            data-testid="troubleshoot-open-panel"
          >
            <span className="troubleshoot__circuit-text">
              {d.panel.name} · Slot {d.breaker.slot}
              {d.breaker.tandemHalf ?? ''}
              {d.breaker.label ? ` · ${d.breaker.label}` : ''}
            </span>
            {d.protection !== null && <ProtectionBadge kind={d.protection} />}
            <ChevronRight size={16} />
          </Link>
        ) : (
          <p className="troubleshoot__circuit troubleshoot__circuit--unwired">
            Not wired to a breaker yet.
          </p>
        )}
      </Card>

      <ol className="troubleshoot__steps" data-testid="troubleshoot-steps">
        {d.steps.map((step, i) => (
          <li key={`${step.kind}-${i}`} className="troubleshoot__step" data-step-kind={step.kind}>
            <span className="troubleshoot__step-num">{i + 1}</span>
            <Card className="troubleshoot__step-card">
              <div className="troubleshoot__step-head">
                <span className="troubleshoot__step-icon">{STEP_ICON[step.kind]}</span>
                <h3 className="troubleshoot__step-title">{step.title}</h3>
              </div>
              <p className="troubleshoot__step-detail">{step.detail}</p>
              {step.href !== undefined && (
                <Link href={step.href} className="troubleshoot__step-link">
                  Open panel <ChevronRight size={14} />
                </Link>
              )}
            </Card>
          </li>
        ))}
      </ol>

      {d.circuitMates.length > 0 && (
        <details className="troubleshoot__mates">
          <summary className="troubleshoot__mates-summary">
            Also on this circuit ({d.circuitMates.length})
          </summary>
          <ul className="troubleshoot__mates-list">
            {d.circuitMates.map((c) => (
              <li key={c.id} className="troubleshoot__mate">
                <span className="troubleshoot__device-icon">{typeIcon(c.type)}</span>
                <span>{c.name}</span>
                <span className="troubleshoot__mate-room">{c.room ?? ''}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="troubleshoot__footer">
        <Button variant="ghost" onClick={onReset}>
          Troubleshoot another device
        </Button>
      </div>
    </div>
  );
};
