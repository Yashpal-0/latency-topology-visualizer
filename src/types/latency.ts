export type TimeRangeKey = '1h' | '24h' | '7d' | '30d';

export type LatencyHistoryPoint = {
  timestamp: string;
  latencyIdle: number | null;
  latencyLoaded: number | null;
  jitterIdle: number | null;
};

export type HistoryStats = {
  min: number | null;
  max: number | null;
  avg: number | null;
  samples: number;
};

