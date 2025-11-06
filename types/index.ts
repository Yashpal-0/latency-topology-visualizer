export interface ExchangeServer {
  id: string;
  name: string;
  location: {
    lat: number;
    lng: number;
    city: string;
    country: string;
  };
  cloudProvider: 'AWS' | 'GCP' | 'Azure';
  region: string;
}

export interface LatencyData {
  from: string;
  to: string;
  latency: number; // in milliseconds
  timestamp: number;
  provider?: 'AWS' | 'GCP' | 'Azure';
}

export interface CloudRegion {
  id: string;
  provider: 'AWS' | 'GCP' | 'Azure';
  name: string;
  code: string;
  location: {
    lat: number;
    lng: number;
  };
  serverCount: number;
}

export interface HistoricalLatency {
  timestamp: number;
  latency: number;
  from: string;
  to: string;
}

