export type SeverityKey = 'c' | 'p' | 'd' | 'n';

export type EventType =
  | 'Missile strike'
  | 'Earthquake'
  | 'Explosion'
  | 'Structural collapse';

export type ViewRoute = 'command' | 'area' | 'building';

export type AreaMode = 'now' | 'swipe' | 'pre' | 'gis' | '3d';

export type AreaTab =
  | 'prio'
  | 'phones'
  | 'rep'
  | 'res'
  | 'inv'
  | 'assets'
  | 'log';

export type ReportFilter = 'all' | 'reported' | 'supported' | 'verified' | 'flagged';

export interface LocationPack {
  id: string;
  name: string;
  city: string;
  cc: 'IL';
  seed: number;
  ll: string;
  h: string[];
  v: string[];
}

export interface Street {
  d: 'v' | 'h';
  x?: number;
  y?: number;
  w: number;
  name: string;
}

export interface CityBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  top: number | null;
  bot: number | null;
  tn: string | null;
  bn: string | null;
  park: boolean;
}

export interface Building {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  floors: number;
  pf: number;
  units: number;
  year: number;
  cons: string;
  shelter: string;
  roof: string;
  fac: string;
  tanks: number;
  street: string;
  side: 0 | 1;
  ent: 'A' | 'B';
  num: number;
  addr: string;
}

export interface CityModel {
  W: number;
  H: number;
  streets: Street[];
  blocks: CityBlock[];
  bl: Building[];
  seed: number;
  loc: LocationPack;
}

export interface PhoneDevice {
  k: number;
  fx: number;
  fy: number;
  floor: number;
  acc: number;
  carrier: string;
  imsi: string;
  rssi: number;
  t2: number;
  t3: number | null;
  dead: number | null;
  reply: string | null;
  rd: number;
  dx: number;
  dy: number;
}

export interface ResidentUnit {
  apt: number;
  floor: number;
  reg: number;
  miss: number | null;
  safe: number | null;
  hosp: number | null;
}

export interface HitBuilding {
  id: number;
  sev: SeverityKey;
  at: number;
  l1: number;
  l2: number;
  l3: number;
  l4m: number | null;
  l4g: number;
  bpA: boolean;
  bpT: number;
  resT: number;
  cov: number;
  os: number | null;
  oe: number | null;
  mr: number | null;
  dr: string | null;
  dev: PhoneDevice[];
  units: ResidentUnit[];
  seed: number;
}

export interface OsintMessage {
  id: number | string;
  b: number;
  t: number;
  ch: string;
  lang: 'he' | 'ar' | 'en';
  floor: number;
  apt?: number;
  srcs: number;
  fake?: boolean;
  cov?: number;
  sms?: boolean;
  txt: string;
}

export interface DroneTask {
  b: number;
  s: number;
  e: number;
}

export interface DroneUnit {
  id: string;
  kind: string;
  free: number;
  tasks: DroneTask[];
}

export interface FlightBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  n: number;
  sw: number;
  T0: number;
  T1: number;
}

export interface EventState {
  loc: LocationPack;
  city: CityModel;
  type: EventType;
  srcIdx: number;
  bsrcIdx: number;
  date: Date;
  poly: [number, number][] | null;
  H: Record<number, HitBuilding>;
  hits: HitBuilding[];
  msgs: OsintMessage[];
  sms: Record<string, number>;
  ver: Record<string | number, boolean>;
  team: Record<number, string | null>;
  /** Commander-defined ordered list of building IDs. Unlisted buildings are "Not ranked". */
  priorityOrder: number[];
  /** Optional commander reason per building ID. */
  priorityReasons: Record<number, string>;
  seq: number;
  fb: FlightBox;
  cx: number;
  cy: number;
  drones: DroneUnit[];
}

export interface LayerItem {
  k: string;
  n: string;
  s: string;
  r: number | null;
  ok: boolean;
  status: 'Ready' | 'Loading' | 'Pending' | 'Needs Starlink' | 'Inferred' | 'None';
}

export interface AreaLayersToggle {
  fp: boolean;
  util: boolean;
  poly: boolean;
  dmg: boolean;
  imsi: boolean;
  osint: boolean;
  drone: boolean;
  teams: boolean;
}
