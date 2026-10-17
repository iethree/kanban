import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { COLUMN_ICON_LABEL } from "../../shared/column-icons";
import { STAT_RANGES, computeStats, type Bucket, type StatRange, type Stats } from "../../shared/stats";
import type { Doc } from "../../shared/types";
import { useActivity, type SubscribeActivity } from "./ActivityView";
import { PRIORITY_LABEL, PriorityIcon, StatusIcon } from "./ui";

/** Enough of the feed to cover any range on a busy board; the server keeps at most 10k entries. */
const HISTORY = 10_000;
const DAY = 86_400_000;

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Charts of how the project is going: open cards over time, throughput, and where cards sit now. */
export function StatsView({
  projectId,
  doc,
  subscribeActivity,
}: {
  projectId: string;
  doc: Doc;
  subscribeActivity: SubscribeActivity;
}) {
  const activity = useActivity(projectId, subscribeActivity, HISTORY);
  const [range, setRange] = useState<StatRange>(30);
  // Recompute at most once a minute for the clock; the doc and feed drive the rest.
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const id = setInterval(() => setMinute(Math.floor(Date.now() / 60_000)), 60_000);
    return () => clearInterval(id);
  }, []);
  const stats = useMemo(() => computeStats(doc, activity.entries, Date.now(), range), [doc, activity.entries, range, minute]);
  const loading = activity.loading && activity.entries.length === 0;

  return (
    <div className={`stats-view${loading ? " is-loading" : ""}`}>
      <div className="stats-filters">
        <div className="range-picker" role="radiogroup" aria-label="Time range">
          {STAT_RANGES.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={range === r} onClick={() => setRange(r)}>
              {r} days
            </button>
          ))}
        </div>
        {activity.error && <span className="form-error">{activity.error}</span>}
      </div>

      <div className="stat-tiles">
        <StatTile
          label="Open cards"
          value={stats.open}
          delta={stats.open - stats.openAtStart}
          goodWhen="down"
          vs={`vs ${range} days ago`}
        />
        <StatTile
          label="Completed"
          value={stats.completed}
          delta={stats.completed - stats.completedBefore}
          goodWhen="up"
          vs={`vs previous ${range} days`}
        />
        <StatTile label="Created" value={stats.created} note={`in the last ${range} days`} />
        <StatTile
          label="Median time to done"
          value={stats.medianLeadDays}
          format={(n) => (n * 24 < 1 ? "<1h" : n < 1 ? `${Math.round(n * 24)}h` : `${n < 10 ? n.toFixed(1).replace(/\.0$/, "") : Math.round(n)}d`)}
          note="from creation, cards completed in range"
        />
      </div>

      <div className="stats-grid">
        <ChartCard title="Burndown" subtitle="Cards not yet done or cancelled, at the end of each day" wide>
          <BurndownChart key={range} stats={stats} />
        </ChartCard>

        <ChartCard
          title="Throughput"
          subtitle={`Cards created and completed per ${stats.buckets[0]?.days === 7 ? "week" : "day"}`}
          legend={
            <>
              <LegendKey className="is-created">Created</LegendKey>
              <LegendKey className="is-completed">Completed</LegendKey>
            </>
          }
          wide
        >
          <ThroughputChart key={range} buckets={stats.buckets} />
        </ChartCard>

        <ChartCard title="By column" subtitle="Where every card is right now">
          <BarList
            key={`c${range}`}
            rows={stats.columns.map((c) => ({
              key: c.id,
              label: c.name || "Untitled",
              icon: <StatusIcon icon={c.icon} />,
              value: c.count,
              tone: `st-${c.icon}`,
              title: COLUMN_ICON_LABEL[c.icon],
            }))}
          />
        </ChartCard>

        <ChartCard title="Open by priority" subtitle="Cards not yet done or cancelled">
          <BarList
            key={`p${range}`}
            rows={stats.priorities.map((p) => ({
              key: p.priority,
              label: PRIORITY_LABEL[p.priority],
              icon: <PriorityIcon priority={p.priority} />,
              value: p.open,
              tone: `pri-${p.priority}`,
            }))}
          />
        </ChartCard>
      </div>

      <details className="stats-table">
        <summary>Show the numbers as a table</summary>
        <DataTable stats={stats} />
      </details>
    </div>
  );
}

// -- pieces ---------------------------------------------------------------------

function ChartCard({
  title,
  subtitle,
  legend,
  wide,
  children,
}: {
  title: string;
  subtitle: string;
  legend?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`chart-card${wide ? " is-wide" : ""}`} aria-label={title}>
      <header className="chart-card-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {legend && <div className="chart-legend">{legend}</div>}
      </header>
      {children}
    </section>
  );
}

const LegendKey = ({ className, children }: { className: string; children: ReactNode }) => (
  <span className="legend-key">
    <span className={`legend-swatch ${className}`} aria-hidden />
    {children}
  </span>
);

/** Counts from the previous value to the new one, so changes are felt as well as seen. */
function useCountUp(target: number | null, duration = 700): number | null {
  const [shown, setShown] = useState(target === null ? null : 0);
  const from = useRef(0);
  useEffect(() => {
    if (target === null) return setShown(null);
    if (reducedMotion()) return setShown(target);
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      const value = origin + (target - origin) * eased;
      from.current = value;
      setShown(value);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return shown;
}

function StatTile({
  label,
  value,
  delta,
  goodWhen,
  vs,
  note,
  format = (n) => String(Math.round(n)),
}: {
  label: string;
  value: number | null;
  delta?: number;
  goodWhen?: "up" | "down";
  vs?: string;
  note?: string;
  format?: (n: number) => string;
}) {
  const shown = useCountUp(value);
  const tone = !delta ? "flat" : (delta > 0) === (goodWhen === "up") ? "good" : "bad";
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value" aria-label={value === null ? "none" : format(value)}>
        {shown === null ? "—" : format(shown)}
      </div>
      {delta !== undefined ? (
        <div className={`stat-delta is-${tone}`}>
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {Math.abs(delta)} <span>{vs}</span>
        </div>
      ) : (
        <div className="stat-delta">
          <span>{note}</span>
        </div>
      )}
    </div>
  );
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** A clean axis maximum (1, 2, 5 × 10ⁿ steps) and its ticks. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw && Number.isInteger(s)) ?? Math.ceil(raw);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

const fmtDay = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Indices to label along an x-axis of `n` points, about every 80px. */
function labelIndices(n: number, width: number): number[] {
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(width / 80))));
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i -= every) out.unshift(i);
  return out;
}

const M = { top: 14, right: 40, bottom: 26, left: 34 };
const HEIGHT = 220;

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return (
    <div className="chart-tooltip" style={{ left }} role="status">
      {children}
    </div>
  );
}

function BurndownChart({ stats }: { stats: Stats }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const points = stats.burndown;
  const ticks = niceTicks(Math.max(...points.map((p) => p.open), 1));
  const top = ticks[ticks.length - 1]!;
  const w = Math.max(0, width - M.left - M.right);
  const h = HEIGHT - M.top - M.bottom;
  const x = (i: number) => M.left + (points.length === 1 ? w : (i / (points.length - 1)) * w);
  const y = (v: number) => M.top + h - (v / top) * h;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.open).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const last = points[points.length - 1]!;

  const pick = (clientX: number, rect: DOMRect) => {
    const i = Math.round(((clientX - rect.left - M.left) / w) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setHover((h) => Math.max(0, Math.min(points.length - 1, (h ?? points.length - 1) + (e.key === "ArrowLeft" ? -1 : 1))));
  };

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Open cards went from ${points[0]!.open} to ${last.open} over ${points.length} days`}
          tabIndex={0}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(points.length - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={onKey}
        >
          <g className="chart-grid">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={M.left + w} y1={y(t)} y2={y(t)} />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                  {t}
                </text>
              </g>
            ))}
            {labelIndices(points.length, w).map((i) => (
              <text key={i} x={x(i)} y={HEIGHT - 6} textAnchor="middle">
                {fmtDay(points[i]!.day)}
              </text>
            ))}
          </g>
          <path className="burndown-area" d={area} />
          <path className="burndown-line" d={line} pathLength={1} />
          <circle className="burndown-end" cx={x(points.length - 1)} cy={y(last.open)} r={4.5} />
          <text className="chart-end-label" x={x(points.length - 1) + 9} y={y(last.open)} dy="0.32em">
            {last.open}
          </text>
          {hover !== null && (
            <g className="chart-crosshair">
              <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + h} />
              <circle cx={x(hover)} cy={y(points[hover]!.open)} r={4.5} />
            </g>
          )}
        </svg>
      )}
      {hover !== null && (
        <Tooltip x={x(hover)} width={width}>
          <strong>{points[hover]!.open} open</strong>
          <span>{fmtDay(points[hover]!.day)}</span>
        </Tooltip>
      )}
    </div>
  );
}

/** A column with a 4px rounded top and a square foot on the baseline. */
function columnPath(x: number, y: number, w: number, base: number): string {
  const h = base - y;
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

function ThroughputChart({ buckets }: { buckets: Bucket[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const ticks = niceTicks(Math.max(...buckets.map((b) => Math.max(b.created, b.completed)), 1));
  const top = ticks[ticks.length - 1]!;
  const w = Math.max(0, width - M.left - M.right);
  const h = HEIGHT - M.top - M.bottom;
  const band = w / buckets.length;
  const bar = Math.max(2, Math.min(24, (band - 6) / 2 - 1));
  const y = (v: number) => M.top + h - (v / top) * h;
  const base = y(0);
  const center = (i: number) => M.left + band * i + band / 2;

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setHover((h) => Math.max(0, Math.min(buckets.length - 1, (h ?? buckets.length - 1) + (e.key === "ArrowLeft" ? -1 : 1))));
  };
  const label = (b: Bucket) => (b.days === 7 ? `Week of ${fmtDay(b.start)}` : fmtDay(b.start));

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${buckets.reduce((n, b) => n + b.created, 0)} created and ${buckets.reduce((n, b) => n + b.completed, 0)} completed`}
          tabIndex={0}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(buckets.length - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={onKey}
        >
          <g className="chart-grid">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={M.left + w} y1={y(t)} y2={y(t)} />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                  {t}
                </text>
              </g>
            ))}
            {labelIndices(buckets.length, w).map((i) => (
              <text key={i} x={center(i)} y={HEIGHT - 6} textAnchor="middle">
                {fmtDay(buckets[i]!.start)}
              </text>
            ))}
          </g>
          {buckets.map((b, i) => (
            <g key={b.start} className={`column-pair${hover === i ? " is-hover" : ""}`} style={{ animationDelay: `${i * 18}ms` }}>
              <path className="col-created" d={columnPath(center(i) - bar - 1, y(b.created), bar, base)} />
              <path className="col-completed" d={columnPath(center(i) + 1, y(b.completed), bar, base)} />
              <rect
                className="chart-hit"
                x={M.left + band * i}
                y={M.top}
                width={band}
                height={h}
                onPointerEnter={() => setHover(i)}
              />
            </g>
          ))}
        </svg>
      )}
      {hover !== null && buckets[hover] && (
        <Tooltip x={center(hover)} width={width}>
          <span className="tooltip-row">
            <span className="line-key is-created" />
            <strong>{buckets[hover]!.created}</strong> created
          </span>
          <span className="tooltip-row">
            <span className="line-key is-completed" />
            <strong>{buckets[hover]!.completed}</strong> completed
          </span>
          <span>{label(buckets[hover]!)}</span>
        </Tooltip>
      )}
    </div>
  );
}

function BarList({
  rows,
}: {
  rows: { key: string; label: string; icon: ReactNode; value: number; tone: string; title?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  // Start at zero width, then grow on the next frame so the transition runs.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <ul className="bar-list">
      {rows.map((r, i) => (
        <li key={r.key} title={r.title}>
          <span className="bar-label">
            {r.icon}
            <span>{r.label}</span>
          </span>
          <span className="bar-track">
            <span
              className={`bar-fill ${r.tone}${r.value ? "" : " is-zero"}`}
              style={{ width: grown ? `${(r.value / max) * 100}%` : 0, transitionDelay: `${i * 50}ms` }}
            />
          </span>
          <span className="bar-value">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

function DataTable({ stats }: { stats: Stats }) {
  const bucketFor = (day: number) => stats.buckets.find((b) => day >= b.start && day < b.start + b.days * DAY);
  const weekly = stats.buckets[0]?.days === 7;
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Day</th>
          <th scope="col">Open at end of day</th>
          <th scope="col">Created{weekly ? " (that week)" : ""}</th>
          <th scope="col">Completed{weekly ? " (that week)" : ""}</th>
        </tr>
      </thead>
      <tbody>
        {[...stats.burndown].reverse().map((p) => {
          const b = bucketFor(p.day);
          const show = !weekly || b?.start === p.day;
          return (
            <tr key={p.day}>
              <td>{new Date(p.day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</td>
              <td>{p.open}</td>
              <td>{show ? (b?.created ?? 0) : ""}</td>
              <td>{show ? (b?.completed ?? 0) : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
