import { ExchangeServer, CloudRegion } from '@/types';

// Major cryptocurrency exchange server locations
export const EXCHANGE_SERVERS: ExchangeServer[] = [
  {
    id: 'binance-1',
    name: 'Binance',
    location: { lat: 1.3521, lng: 103.8198, city: 'Singapore', country: 'Singapore' },
    cloudProvider: 'AWS',
    region: 'ap-southeast-1',
  },
  {
    id: 'binance-2',
    name: 'Binance',
    location: { lat: 40.7128, lng: -74.0060, city: 'New York', country: 'USA' },
    cloudProvider: 'AWS',
    region: 'us-east-1',
  },
  {
    id: 'okx-1',
    name: 'OKX',
    location: { lat: 31.2304, lng: 121.4737, city: 'Shanghai', country: 'China' },
    cloudProvider: 'GCP',
    region: 'asia-east1',
  },
  {
    id: 'okx-2',
    name: 'OKX',
    location: { lat: 51.5074, lng: -0.1278, city: 'London', country: 'UK' },
    cloudProvider: 'AWS',
    region: 'eu-west-2',
  },
  {
    id: 'deribit-1',
    name: 'Deribit',
    location: { lat: 52.3676, lng: 4.9041, city: 'Amsterdam', country: 'Netherlands' },
    cloudProvider: 'AWS',
    region: 'eu-central-1',
  },
  {
    id: 'bybit-1',
    name: 'Bybit',
    location: { lat: 22.3193, lng: 114.1694, city: 'Hong Kong', country: 'Hong Kong' },
    cloudProvider: 'Azure',
    region: 'eastasia',
  },
  {
    id: 'bybit-2',
    name: 'Bybit',
    location: { lat: 37.7749, lng: -122.4194, city: 'San Francisco', country: 'USA' },
    cloudProvider: 'AWS',
    region: 'us-west-1',
  },
  {
    id: 'coinbase-1',
    name: 'Coinbase',
    location: { lat: 37.7749, lng: -122.4194, city: 'San Francisco', country: 'USA' },
    cloudProvider: 'AWS',
    region: 'us-west-1',
  },
  {
    id: 'kraken-1',
    name: 'Kraken',
    location: { lat: 47.6062, lng: -122.3321, city: 'Seattle', country: 'USA' },
    cloudProvider: 'AWS',
    region: 'us-west-2',
  },
  {
    id: 'bitfinex-1',
    name: 'Bitfinex',
    location: { lat: 25.0330, lng: 121.5654, city: 'Taipei', country: 'Taiwan' },
    cloudProvider: 'GCP',
    region: 'asia-east1',
  },
  {
    id: 'binance-3',
    name: 'Binance',
    location: { lat: 35.6762, lng: 139.6503, city: 'Tokyo', country: 'Japan' },
    cloudProvider: 'AWS',
    region: 'ap-northeast-1',
  },
  {
    id: 'okx-3',
    name: 'OKX',
    location: { lat: 35.6762, lng: 139.6503, city: 'Tokyo', country: 'Japan' },
    cloudProvider: 'GCP',
    region: 'asia-northeast1',
  },
  {
    id: 'bybit-3',
    name: 'Bybit',
    location: { lat: 1.3521, lng: 103.8198, city: 'Singapore', country: 'Singapore' },
    cloudProvider: 'Azure',
    region: 'southeastasia',
  },
  {
    id: 'deribit-2',
    name: 'Deribit',
    location: { lat: 25.0330, lng: 121.5654, city: 'Taipei', country: 'Taiwan' },
    cloudProvider: 'AWS',
    region: 'ap-northeast-1',
  },
  {
    id: 'coinbase-2',
    name: 'Coinbase',
    location: { lat: 40.7128, lng: -74.0060, city: 'New York', country: 'USA' },
    cloudProvider: 'AWS',
    region: 'us-east-1',
  },
  {
    id: 'kraken-2',
    name: 'Kraken',
    location: { lat: 51.5074, lng: -0.1278, city: 'London', country: 'UK' },
    cloudProvider: 'AWS',
    region: 'eu-west-2',
  },
  {
    id: 'ftx-1',
    name: 'FTX',
    location: { lat: 25.7617, lng: -80.1918, city: 'Miami', country: 'USA' },
    cloudProvider: 'AWS',
    region: 'us-east-1',
  },
  {
    id: 'huobi-1',
    name: 'Huobi',
    location: { lat: 39.9042, lng: 116.4074, city: 'Beijing', country: 'China' },
    cloudProvider: 'GCP',
    region: 'asia-east1',
  },
  {
    id: 'kucoin-1',
    name: 'KuCoin',
    location: { lat: 1.3521, lng: 103.8198, city: 'Singapore', country: 'Singapore' },
    cloudProvider: 'Azure',
    region: 'southeastasia',
  },
];

// Major cloud provider regions
export const CLOUD_REGIONS: CloudRegion[] = [
  // AWS Regions
  { id: 'aws-us-east-1', provider: 'AWS', name: 'US East (N. Virginia)', code: 'us-east-1', location: { lat: 38.9072, lng: -77.0369 }, serverCount: 3 },
  { id: 'aws-us-west-1', provider: 'AWS', name: 'US West (N. California)', code: 'us-west-1', location: { lat: 37.7749, lng: -122.4194 }, serverCount: 2 },
  { id: 'aws-eu-central-1', provider: 'AWS', name: 'Europe (Frankfurt)', code: 'eu-central-1', location: { lat: 50.1109, lng: 8.6821 }, serverCount: 1 },
  { id: 'aws-ap-southeast-1', provider: 'AWS', name: 'Asia Pacific (Singapore)', code: 'ap-southeast-1', location: { lat: 1.3521, lng: 103.8198 }, serverCount: 1 },
  // GCP Regions
  { id: 'gcp-asia-east1', provider: 'GCP', name: 'Asia East (Taiwan)', code: 'asia-east1', location: { lat: 25.0330, lng: 121.5654 }, serverCount: 2 },
  { id: 'gcp-europe-west1', provider: 'GCP', name: 'Europe West (Belgium)', code: 'europe-west1', location: { lat: 50.8503, lng: 4.3517 }, serverCount: 0 },
  // Azure Regions
  { id: 'azure-eastasia', provider: 'Azure', name: 'East Asia (Hong Kong)', code: 'eastasia', location: { lat: 22.3193, lng: 114.1694 }, serverCount: 1 },
  { id: 'azure-westus', provider: 'Azure', name: 'West US (California)', code: 'westus', location: { lat: 37.7749, lng: -122.4194 }, serverCount: 0 },
];

