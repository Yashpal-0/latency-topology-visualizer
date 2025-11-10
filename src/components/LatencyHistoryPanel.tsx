import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  HistoryStats,
  LatencyHistoryPoint,
  TimeRangeKey,
} from '@/types/latency';

type SelectOption = {
  id: string;
  label: string;
};

type LatencyHistoryPanelProps = {
  exchangeOptions: SelectOption[];
  regionOptions: SelectOption[];
  selectedExchange: string;
  onSelectExchange: (exchangeId: string) => void;
  selectedRegion: string;
  onSelectRegion: (regionId: string) => void;
  selectedRange: TimeRangeKey;
  onSelectRange: (range: TimeRangeKey) => void;
  history: LatencyHistoryPoint[];
  stats: HistoryStats | null;
  loading: boolean;
  error: string | null;
  lastUpdatedLabel: string | null;
};

const RANGE_OPTIONS: { key: TimeRangeKey; label: string }[] = [
  { key: '1h', label: '1 hour' },
  { key: '24h', label: '24 hours' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
];

const tooltipFormatter = (value: number | string | Array<number | string>) => {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'number') {
    return `${value.toFixed(2)} ms`;
  }
  return value;
};

type ChartDatum = {
  timestamp: string;
  latency: number | null;
};

export default function LatencyHistoryPanel({
  exchangeOptions,
  regionOptions,
  selectedExchange,
  onSelectExchange,
  selectedRegion,
  onSelectRegion,
  selectedRange,
  onSelectRange,
  history,
  stats,
  loading,
  error,
  lastUpdatedLabel,
}: LatencyHistoryPanelProps) {
  const chartData: ChartDatum[] = useMemo(
    () =>
      history.map((point) => ({
        timestamp: point.timestamp,
        latency:
          typeof point.latencyIdle === 'number' ? point.latencyIdle : null,
      })),
    [history]
  );

  const hasData = chartData.some((item) => item.latency !== null);

  return (
    <section className="pointer-events-auto flex w-full flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-slate-100 shadow-2xl backdrop-blur md:max-w-md">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">
            Latency History
          </h3>
          {lastUpdatedLabel && (
            <span className="text-xs text-slate-400">
              Queried {lastUpdatedLabel}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2 text-xs text-slate-300">
          <label className="flex flex-col gap-1">
            <span className="uppercase tracking-[0.25em] text-slate-500">
              Exchange
            </span>
            <select
              className="rounded-md border border-white/10 bg-slate-900/80 px-2 py-1 text-slate-100 outline-none focus:border-cyan-400"
              value={selectedExchange}
              onChange={(event) => onSelectExchange(event.target.value)}
              disabled={exchangeOptions.length === 0}
            >
              {exchangeOptions.length === 0 ? (
                <option value="">No exchanges available</option>
              ) : (
                exchangeOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="uppercase tracking-[0.25em] text-slate-500">
              Cloud Region
            </span>
            <select
              className="rounded-md border border-white/10 bg-slate-900/80 px-2 py-1 text-slate-100 outline-none focus:border-cyan-400"
              value={selectedRegion}
              onChange={(event) => onSelectRegion(event.target.value)}
              disabled={regionOptions.length === 0}
            >
              {regionOptions.length === 0 ? (
                <option value="">No regions available</option>
              ) : (
                regionOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))
              )}
            </select>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <span className="uppercase tracking-[0.25em] text-slate-500">
              Range
            </span>
            <div className="flex flex-wrap gap-2">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => onSelectRange(option.key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    selectedRange === option.key
                      ? 'bg-cyan-400/80 text-slate-900'
                      : 'bg-slate-900/80 text-slate-200 hover:bg-slate-800/80'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <StatPill label="Min" value={stats?.min} />
          <StatPill label="Avg" value={stats?.avg} />
          <StatPill label="Max" value={stats?.max} />
        </div>

        <div className="h-48 w-full rounded-xl border border-white/5 bg-slate-900/60">
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.35em] text-slate-500">
              Loading…
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-rose-300">
              {error}
            </div>
          ) : !hasData ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-slate-400">
              No latency samples available for the selected inputs.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke="rgba(148, 163, 184, 0.2)" />
                <XAxis
                  dataKey="timestamp"
                  tick={{ fontSize: 10, fill: '#cbd5f5' }}
                  tickFormatter={(value) =>
                    new Intl.DateTimeFormat(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                      day: 'numeric',
                      month: 'short',
                    }).format(new Date(value))
                  }
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#cbd5f5' }}
                  tickFormatter={(value) => `${value} ms`}
                  width={50}
                />
                <Tooltip
                  cursor={{ stroke: 'rgba(56, 189, 248, 0.35)' }}
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderRadius: '0.75rem',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    color: '#e2e8f0',
                  }}
                  labelFormatter={(value) =>
                    new Intl.DateTimeFormat(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(value))
                  }
                  formatter={tooltipFormatter}
                />
                <Line
                  type="monotone"
                  dataKey="latency"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </section>
  );
}

type StatPillProps = {
  label: string;
  value: number | null | undefined;
};

function StatPill({ label, value }: StatPillProps) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-slate-900/70 px-3 py-2 text-xs">
      <span className="uppercase tracking-[0.25em] text-slate-500">
        {label}
      </span>
      <span className="text-sm font-semibold text-cyan-300">
        {typeof value === 'number' ? `${value.toFixed(2)} ms` : '—'}
      </span>
    </div>
  );
}

