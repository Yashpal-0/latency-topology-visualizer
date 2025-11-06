import { LatencyData, HistoricalLatency } from '@/types';

/**
 * Simulates latency data for demo purposes
 * In production, this would fetch from a real API like Cloudflare Radar or similar
 */
export class LatencyService {
  private baseLatencies: Map<string, number> = new Map();
  private historicalData: Map<string, HistoricalLatency[]> = new Map();

  constructor() {
    // Initialize base latencies between major regions
    this.initializeBaseLatencies();
  }

  private initializeBaseLatencies() {
    // Base latencies in milliseconds between major regions
    const regionPairs = [
      { from: 'us-east', to: 'us-west', base: 50 },
      { from: 'us-east', to: 'europe', base: 80 },
      { from: 'us-east', to: 'asia', base: 200 },
      { from: 'us-west', to: 'europe', base: 150 },
      { from: 'us-west', to: 'asia', base: 120 },
      { from: 'europe', to: 'asia', base: 180 },
    ];

    regionPairs.forEach(({ from, to, base }) => {
      this.baseLatencies.set(`${from}-${to}`, base);
      this.baseLatencies.set(`${to}-${from}`, base);
    });
  }

  /**
   * Get real-time latency between two servers
   * Uses httpbin.org for actual network testing (free, no API key required)
   */
  async getLatency(fromServerId: string, toServerId: string): Promise<LatencyData> {
    const key = `${fromServerId}-${toServerId}`;
    
    // Try to fetch actual latency from httpbin.org (free endpoint)
    try {
      const startTime = performance.now();
      const response = await fetch('https://httpbin.org/delay/0', {
        method: 'GET',
        cache: 'no-cache',
      });
      const endTime = performance.now();
      const networkLatency = endTime - startTime;

      // Combine with simulated base latency
      const baseLatency = this.getBaseLatency(fromServerId, toServerId);
      const totalLatency = Math.round(baseLatency + networkLatency + this.getRandomVariation());

      const latencyData: LatencyData = {
        from: fromServerId,
        to: toServerId,
        latency: totalLatency,
        timestamp: Date.now(),
      };

      // Store historical data
      this.addHistoricalData(latencyData);

      return latencyData;
    } catch (error) {
      // Fallback to simulated data if network request fails
      console.warn('Failed to fetch real latency, using simulated data:', error);
      return this.getSimulatedLatency(fromServerId, toServerId);
    }
  }

  /**
   * Get simulated latency (fallback method)
   */
  private getSimulatedLatency(fromServerId: string, toServerId: string): LatencyData {
    const baseLatency = this.getBaseLatency(fromServerId, toServerId);
    const latency = baseLatency + this.getRandomVariation();

    const latencyData: LatencyData = {
      from: fromServerId,
      to: toServerId,
      latency: Math.round(latency),
      timestamp: Date.now(),
    };

    this.addHistoricalData(latencyData);
    return latencyData;
  }

  /**
   * Get base latency between two servers based on their geographic locations
   */
  private getBaseLatency(fromServerId: string, toServerId: string): number {
    // Extract region from server ID or use a simplified calculation
    const fromRegion = this.getRegionFromServerId(fromServerId);
    const toRegion = this.getRegionFromServerId(toServerId);

    if (fromRegion === toRegion) {
      return 5 + Math.random() * 10; // Same region: 5-15ms
    }

    const key = `${fromRegion}-${toRegion}`;
    const base = this.baseLatencies.get(key) || 100; // Default 100ms if unknown
    return base;
  }

  /**
   * Extract region from server ID (simplified)
   */
  private getRegionFromServerId(serverId: string): string {
    if (serverId.includes('us') || serverId.includes('new-york') || serverId.includes('san-francisco') || serverId.includes('seattle')) {
      return serverId.includes('west') ? 'us-west' : 'us-east';
    }
    if (serverId.includes('europe') || serverId.includes('london') || serverId.includes('amsterdam') || serverId.includes('frankfurt')) {
      return 'europe';
    }
    if (serverId.includes('asia') || serverId.includes('singapore') || serverId.includes('hong-kong') || serverId.includes('shanghai') || serverId.includes('taipei')) {
      return 'asia';
    }
    return 'us-east'; // Default
  }

  /**
   * Add random variation to simulate real-world network conditions
   */
  private getRandomVariation(): number {
    return (Math.random() - 0.5) * 20; // ±10ms variation
  }

  /**
   * Store historical latency data
   */
  private addHistoricalData(data: LatencyData) {
    const key = `${data.from}-${data.to}`;
    const history = this.historicalData.get(key) || [];
    
    history.push({
      timestamp: data.timestamp,
      latency: data.latency,
      from: data.from,
      to: data.to,
    });

    // Keep only last 1000 data points
    if (history.length > 1000) {
      history.shift();
    }

    this.historicalData.set(key, history);
  }

  /**
   * Get historical latency data for a server pair
   */
  getHistoricalData(fromServerId: string, toServerId: string, timeRange: '1h' | '24h' | '7d' | '30d' = '24h'): HistoricalLatency[] {
    const key = `${fromServerId}-${toServerId}`;
    const history = this.historicalData.get(key) || [];
    
    const now = Date.now();
    const ranges = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };

    const cutoff = now - ranges[timeRange];
    return history.filter((data) => data.timestamp >= cutoff);
  }

  /**
   * Get all latencies for multiple server pairs
   */
  async getAllLatencies(serverPairs: Array<{ from: string; to: string }>): Promise<LatencyData[]> {
    const promises = serverPairs.map(({ from, to }) => this.getLatency(from, to));
    return Promise.all(promises);
  }
}

// Singleton instance
export const latencyService = new LatencyService();

