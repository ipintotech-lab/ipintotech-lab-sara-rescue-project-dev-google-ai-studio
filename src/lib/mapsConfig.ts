import type {Building, LocationPack} from '../types/sara';

export const GOOGLE_MAPS_API_KEY: string = (
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  (typeof process !== 'undefined' ? process.env?.GOOGLE_MAPS_API_KEY : '') ||
  ''
).trim();

/** Mandatory AI Studio Google Maps Platform attribution ID */
export const GMP_ATTRIBUTION_IDS: string[] = ['gmp_mcp_codeassist_v1_aistudio'];

/** Required Map ID when rendering AdvancedMarker components */
export const DEMO_MAP_ID = 'DEMO_MAP_ID';

/** Real Israel neighborhood centers matching LOCS in src/sim/engine.ts */
export const SECTOR_CENTERS: Record<string, {lat: number; lng: number}> = {
  batyam: {lat: 32.012, lng: 34.749},
  haifa: {lat: 32.809, lng: 34.998},
  rehovot: {lat: 31.898, lng: 34.811},
  tamra: {lat: 32.853, lng: 35.198},
};

export function formatLatLngLabel(lat: number, lng: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew}`;
}

export function getLocationCenter(loc: LocationPack): {lat: number; lng: number} {
  if (typeof loc.lat === 'number' && typeof loc.lng === 'number') {
    return {lat: loc.lat, lng: loc.lng};
  }
  if (SECTOR_CENTERS[loc.id]) return SECTOR_CENTERS[loc.id];
  const m = loc.ll.match(/([\d.-]+)\s*°?\s*([NS])?.*?,\s*([\d.-]+)\s*°?\s*([EW])?/i);
  if (m) {
    let lat = Number(m[1]);
    let lng = Number(m[3]);
    if (m[2]?.toUpperCase() === 'S' && lat > 0) lat = -lat;
    if (m[4]?.toUpperCase() === 'W' && lng > 0) lng = -lng;
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      return {lat, lng};
    }
  }
  return {lat: 32.012, lng: 34.749};
}

export function createSearchedLocationPack(params: {
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
}): LocationPack {
  const parts = params.formattedAddress
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const primaryStreet =
    (params.name && params.name.trim()) || parts[0] || 'Searched Street';
  const cityLabel =
    parts.length >= 2
      ? parts[parts.length >= 3 ? parts.length - 2 : 1].replace(/\d{4,}/g, '').trim() ||
        parts[0]
      : primaryStreet;
  const countryLabel =
    parts.length >= 2 ? parts[parts.length - 1] : 'Google Maps';

  const cleanStreet = primaryStreet.replace(/\s+\d+[A-Za-z-]*$/, '').trim() || primaryStreet;
  const seed = Math.max(
    100,
    Math.abs(Math.round(params.lat * 10000) * 31 + Math.round(params.lng * 10000)) % 90000
  );

  const inIsrael =
    params.lat >= 29.4 && params.lat <= 33.4 && params.lng >= 34.2 && params.lng <= 35.9;

  const hFallback = inIsrael
    ? ['Herzl', 'HaAtzmaut', 'Balfour', 'Ben Gurion', 'Sokolov', 'Jabotinsky']
    : ['Main Ave', 'Central Blvd', 'Market St', 'Park Ave', 'Station Rd', 'North St'];
  const vFallback = inIsrael
    ? ['Rothschild', 'Weizmann', 'Bialik', 'Arlozorov', 'Nordau', 'Katznelson', 'HaPalmach']
    : ['1st Ave', '2nd Ave', '3rd Ave', 'Oak St', 'Cedar St', 'Elm St', 'Bridge Rd'];

  const h = [cleanStreet, ...hFallback.filter((s) => s.toLowerCase() !== cleanStreet.toLowerCase())];

  return {
    id: `search-${seed}-${Math.round(Math.abs(params.lat + params.lng) * 100)}`,
    name: parts.slice(0, 2).join(' — ') || params.name || params.formattedAddress,
    city: cityLabel || cleanStreet,
    cc: inIsrael ? 'IL' : 'CUSTOM',
    countryLabel,
    seed,
    ll: formatLatLngLabel(params.lat, params.lng),
    lat: params.lat,
    lng: params.lng,
    h,
    v: vFallback,
  };
}

/**
 * Converts a local 1200x800 SVG coordinate (representing 600m x 400m around the
 * Israeli neighborhood center) into a WGS84 LatLngLiteral for map overlays.
 */
export function cityPtToLatLng(
  loc: LocationPack,
  x: number,
  y: number
): google.maps.LatLngLiteral {
  const center = getLocationCenter(loc);
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((center.lat * Math.PI) / 180);
  const dxMeters = (x - 600) * 0.5;
  const dyMeters = (400 - y) * 0.5;
  return {
    lat: center.lat + dyMeters / metersPerDegLat,
    lng: center.lng + dxMeters / metersPerDegLng,
  };
}

/** 600m x 400m sector perimeter polygon in WGS84 coordinates. */
export function citySectorPolygon(loc: LocationPack): google.maps.LatLngLiteral[] {
  return [
    cityPtToLatLng(loc, 0, 0),
    cityPtToLatLng(loc, 1200, 0),
    cityPtToLatLng(loc, 1200, 800),
    cityPtToLatLng(loc, 0, 800),
  ];
}

export function buildingFootprintLatLng(
  loc: LocationPack,
  b: Building
): google.maps.LatLngLiteral[] {
  return [
    cityPtToLatLng(loc, b.x, b.y),
    cityPtToLatLng(loc, b.x + b.w, b.y),
    cityPtToLatLng(loc, b.x + b.w, b.y + b.h),
    cityPtToLatLng(loc, b.x, b.y + b.h),
  ];
}

export function dispatchQuotaExceeded(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
}
