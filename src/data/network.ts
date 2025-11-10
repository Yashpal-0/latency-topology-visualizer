export type CloudProvider = 'AWS' | 'GCP' | 'Azure';

export type ExchangeLocation = {
  id: string;
  name: string;
  city: string;
  country: string;
  provider: CloudProvider;
  coordinates: [number, number];
};

export type CloudRegion = {
  id: string;
  provider: CloudProvider;
  name: string;
  city: string;
  country: string;
  countryCode: string;
  regionCode: string;
  coordinates: [number, number];
};

export const EXCHANGE_LOCATIONS: ExchangeLocation[] = [
  {
    id: 'binance-ldn',
    name: 'Binance',
    city: 'London',
    country: 'United Kingdom',
    provider: 'AWS',
    coordinates: [-0.1276, 51.5072],
  },
  {
    id: 'bybit-sgp',
    name: 'Bybit',
    city: 'Singapore',
    country: 'Singapore',
    provider: 'GCP',
    coordinates: [103.8198, 1.3521],
  },
  {
    id: 'deribit-ams',
    name: 'Deribit',
    city: 'Amsterdam',
    country: 'Netherlands',
    provider: 'Azure',
    coordinates: [4.9041, 52.3676],
  },
  {
    id: 'okx-hk',
    name: 'OKX',
    city: 'Hong Kong',
    country: 'China',
    provider: 'Azure',
    coordinates: [114.1095, 22.3964],
  },
  {
    id: 'coinbase-nyc',
    name: 'Coinbase',
    city: 'New York',
    country: 'United States',
    provider: 'AWS',
    coordinates: [-74.006, 40.7128],
  },
  {
    id: 'kraken-sfo',
    name: 'Kraken',
    city: 'San Francisco',
    country: 'United States',
    provider: 'GCP',
    coordinates: [-122.4194, 37.7749],
  },
  {
    id: 'bitstamp-fra',
    name: 'Bitstamp',
    city: 'Frankfurt',
    country: 'Germany',
    provider: 'AWS',
    coordinates: [8.6821, 50.1109],
  },
  {
    id: 'bitfinex-zrh',
    name: 'Bitfinex',
    city: 'Zurich',
    country: 'Switzerland',
    provider: 'Azure',
    coordinates: [8.5417, 47.3769],
  },
  {
    id: 'gemini-chi',
    name: 'Gemini',
    city: 'Chicago',
    country: 'United States',
    provider: 'AWS',
    coordinates: [-87.6298, 41.8781],
  },
  {
    id: 'huobi-hk',
    name: 'Huobi',
    city: 'Hong Kong',
    country: 'China',
    provider: 'GCP',
    coordinates: [114.1095, 22.3964],
  },
  {
    id: 'upbit-seoul',
    name: 'Upbit',
    city: 'Seoul',
    country: 'South Korea',
    provider: 'Azure',
    coordinates: [126.978, 37.5665],
  },
];

export const CLOUD_REGIONS: CloudRegion[] = [
  {
    id: 'aws-virginia',
    provider: 'AWS',
    name: 'AWS us-east-1',
    city: 'Ashburn',
    country: 'United States',
    countryCode: 'US',
    regionCode: 'us-east-1',
    coordinates: [-77.4875, 39.0438],
  },
  {
    id: 'aws-london',
    provider: 'AWS',
    name: 'AWS eu-west-2',
    city: 'London',
    country: 'United Kingdom',
    countryCode: 'GB',
    regionCode: 'eu-west-2',
    coordinates: [-0.118092, 51.509865],
  },
  {
    id: 'aws-frankfurt',
    provider: 'AWS',
    name: 'AWS eu-central-1',
    city: 'Frankfurt',
    country: 'Germany',
    countryCode: 'DE',
    regionCode: 'eu-central-1',
    coordinates: [8.6821, 50.1109],
  },
  {
    id: 'gcp-singapore',
    provider: 'GCP',
    name: 'GCP asia-southeast1',
    city: 'Singapore',
    country: 'Singapore',
    countryCode: 'SG',
    regionCode: 'asia-southeast1',
    coordinates: [103.851959, 1.29027],
  },
  {
    id: 'gcp-california',
    provider: 'GCP',
    name: 'GCP us-west2',
    city: 'Los Angeles',
    country: 'United States',
    countryCode: 'US',
    regionCode: 'us-west2',
    coordinates: [-118.2417, 34.0549],
  },
  {
    id: 'gcp-hongkong',
    provider: 'GCP',
    name: 'GCP asia-east2',
    city: 'Hong Kong',
    country: 'China',
    countryCode: 'HK',
    regionCode: 'asia-east2',
    coordinates: [114.1694, 22.3193],
  },
  {
    id: 'azure-amsterdam',
    provider: 'Azure',
    name: 'Azure West Europe',
    city: 'Amsterdam',
    country: 'Netherlands',
    countryCode: 'NL',
    regionCode: 'westeurope',
    coordinates: [4.9041, 52.3676],
  },
  {
    id: 'azure-hongkong',
    provider: 'Azure',
    name: 'Azure East Asia',
    city: 'Hong Kong',
    country: 'China',
    countryCode: 'HK',
    regionCode: 'eastasia',
    coordinates: [114.1694, 22.3193],
  },
  {
    id: 'azure-zurich',
    provider: 'Azure',
    name: 'Azure Switzerland North',
    city: 'Zurich',
    country: 'Switzerland',
    countryCode: 'CH',
    regionCode: 'switzerlandnorth',
    coordinates: [8.5417, 47.3769],
  },
  {
    id: 'azure-seoul',
    provider: 'Azure',
    name: 'Azure Korea Central',
    city: 'Seoul',
    country: 'South Korea',
    countryCode: 'KR',
    regionCode: 'koreacentral',
    coordinates: [126.978, 37.5665],
  },
];


