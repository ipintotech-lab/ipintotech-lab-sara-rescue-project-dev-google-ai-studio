import type {
  Building,
  CityBlock,
  CityModel,
  EventState,
  EventType,
  HitBuilding,
  LayerItem,
  LocationPack,
  OsintMessage,
  PhoneDevice,
  ResidentUnit,
  SeverityKey,
  Street,
} from '../types/sara';

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');
export const fT = (t: number) => {
  const safe = Math.max(0, t);
  return `T+${pad(Math.floor(safe / 60))}:${pad(Math.floor(safe % 60))}`;
};
export const fl = (f: number) => (f === 0 ? 'G' : String(f));
export const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export interface Rng {
  (): number;
  int: (l: number, h: number) => number;
  r: (l: number, h: number) => number;
  pick: <T>(a: readonly T[]) => T;
}

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const f = (() => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  f.int = (l: number, h: number) => l + Math.floor(f() * (h - l + 1));
  f.r = (l: number, h: number) => l + f() * (h - l);
  f.pick = <T>(arr: readonly T[]) => arr[Math.floor(f() * arr.length)];
  return f;
}

/** Israel-only locations per PROJECT_CONTEXT.md */
export const LOCS: LocationPack[] = [
  {
    id: 'batyam',
    name: 'Bat Yam — Ramat Yosef',
    city: 'Bat Yam',
    cc: 'IL',
    seed: 1301,
    ll: '32.012° N, 34.749° E',
    h: ['HaAtzmaut', 'Balfour', 'Yoseftal', 'Sokolov', 'Ben Gurion', 'Herzl', 'HaKomemiyut'],
    v: ['Rothschild', 'Arlozorov', 'Bialik', 'Weizmann', 'Katznelson', 'Hanna Senesh', 'Nordau', 'Jabotinsky'],
  },
  {
    id: 'haifa',
    name: 'Haifa — Hadar HaCarmel',
    city: 'Haifa',
    cc: 'IL',
    seed: 2207,
    ll: '32.809° N, 34.998° E',
    h: ['Herzl', 'HaHalutz', 'Masada', 'Arlozorov', 'Balfour', "HaNevi'im"],
    v: ['Shmaryahu Levin', 'Nordau', 'Hillel', 'Syrkin', 'Pevsner', 'Bialik', "Ahad Ha'am"],
  },
  {
    id: 'rehovot',
    name: 'Rehovot — Old North',
    city: 'Rehovot',
    cc: 'IL',
    seed: 3313,
    ll: '31.898° N, 34.811° E',
    h: ['Herzl', 'Bilu', "Ya'akov", 'Ezra', 'Gordon', 'HaShomer'],
    v: ['Weizmann', 'Rabin', 'Moskowitz', 'Levin Epstein', 'Sirni', 'Ben Yehuda', "Ahad Ha'am"],
  },
  {
    id: 'tamra',
    name: 'Tamra — Center',
    city: 'Tamra',
    cc: 'IL',
    seed: 4409,
    ll: '32.853° N, 35.198° E',
    h: ['Main St.', 'Al-Bayader', 'Al-Zaytoun', 'Al-Nur', 'Al-Salam', 'Al-Quds'],
    v: ['Al-Madares', 'Al-Jamea', 'Al-Rabie', 'Al-Wadi', 'Al-Bustan', 'Al-Karmel', 'Al-Ain'],
  },
];

export const SRC_IL = {
  base: [
    'GovMap orthophoto 2024 (Survey of Israel)',
    'OpenStreetMap',
    'Google Maps satellite (online only)',
  ],
  b: ['GovMap buildings + Overture', 'Overture Maps buildings', 'OpenStreetMap'],
  arch: 'Municipal engineering archive',
  res: 'Municipal residents register + 104 list',
  teams: [
    'Unassigned',
    'HFC Rescue 1',
    'HFC Rescue 2',
    'Fire & Rescue — Dan',
    'MDA',
    'United Hatzalah',
  ],
};

export const EVENT_TYPES: EventType[] = [
  'Missile strike',
  'Earthquake',
  'Explosion',
  'Structural collapse',
];

export const SEV: Record<SeverityKey, { n: string; col: string; w: number }> = {
  c: { n: 'Collapsed', col: '#ff4d2e', w: 40 },
  p: { n: 'Partial collapse', col: '#ff9a3c', w: 25 },
  d: { n: 'Damaged', col: '#f2d14e', w: 10 },
  n: { n: 'No damage', col: '#45c4ea', w: 0 },
};

const CARR_IL = ['Partner', 'Cellcom', 'Pelephone', 'HOT mobile', 'Golan'];

const REPLIES = [
  '2 of us, floor {F}, near the stairs. My leg is stuck',
  'Under the kitchen table. I can hear you knocking',
  'Me and my mother. Air is OK. Battery 9%',
  'In the safe room, the door is jammed',
  "I am alone, can't move my arm. Please hurry",
];

export function genCity(loc: LocationPack): CityModel {
  const R = rng(loc.seed);
  const W = 1200;
  const H = 800;
  const vx: number[] = [];
  const hy: number[] = [];

  for (let x = R.int(70, 120); x < W - 20; x += R.int(170, 215)) vx.push(x);
  for (let y = R.int(55, 90); y < H - 20; y += R.int(140, 172)) hy.push(y);

  const vw = vx.map((_, i) => (i % 3 === 1 ? 30 : 18));
  const hw = hy.map((_, i) => (i % 2 === 0 ? 26 : 18));

  const streets: Street[] = [
    ...vx.map((x, i) => ({ d: 'v' as const, x, w: vw[i], name: loc.v[i % loc.v.length] })),
    ...hy.map((y, i) => ({ d: 'h' as const, y, w: hw[i], name: loc.h[i % loc.h.length] })),
  ];

  const X = [-60, ...vx, W + 60];
  const Y = [-60, ...hy, H + 60];
  const hx = (k: number) => (k >= 1 && k <= vx.length ? vw[k - 1] / 2 : 0);
  const hyw = (k: number) => (k >= 1 && k <= hy.length ? hw[k - 1] / 2 : 0);

  const blocks: CityBlock[] = [];
  const bl: Building[] = [];
  const park = [R.int(1, Math.max(1, vx.length - 1)), R.int(1, Math.max(1, hy.length - 1))];

  for (let i = 0; i < X.length - 1; i++) {
    for (let j = 0; j < Y.length - 1; j++) {
      const x = X[i] + hx(i) + 3;
      const y = Y[j] + hyw(j) + 3;
      const b: CityBlock = {
        x,
        y,
        w: X[i + 1] - hx(i + 1) - 3 - x,
        h: Y[j + 1] - hyw(j + 1) - 3 - y,
        top: j >= 1 ? hy[j - 1] : null,
        bot: j < hy.length ? hy[j] : null,
        tn: j >= 1 ? streets[vx.length + j - 1].name : null,
        bn: j < hy.length ? streets[vx.length + j].name : null,
        park: i === park[0] && j === park[1],
      };
      blocks.push(b);
    }
  }

  for (const b of blocks) {
    if (b.park) continue;
    const rows = b.h > 105 ? 2 : 1;
    const rh = b.h / rows;
    for (let r = 0; r < rows; r++) {
      let cx = b.x + 3;
      const end = b.x + b.w - 3;
      while (end - cx >= 34) {
        let lw = R.int(44, 72);
        if (end - cx - lw < 34) lw = end - cx;
        if (R() > 0.1) {
          const m = R.int(3, 7);
          const w = Math.max(22, lw - 2 * m - R.int(0, 6));
          const h = Math.max(22, Math.min(rh - 2 * m - R.int(0, 10), 72));
          const y =
            rows === 1
              ? b.y + (b.h - h) / 2
              : r === 0
                ? b.y + m + 1
                : b.y + b.h - m - 1 - h;
          const x = cx + m + R.int(0, Math.max(0, lw - 2 * m - w));
          const cxx = x + w / 2;
          const cyy = y + h / 2;
          if (cxx > -5 && cxx < W + 5 && cyy > -5 && cyy < H + 5) {
            const tall = R() < 0.12;
            const floors = tall ? R.int(10, 16) : R.int(3, 8);
            const area = w * 0.5 * h * 0.5;
            const pf = clamp(Math.round(area / 95), 2, 6);
            const yr = tall ? R.int(1996, 2019) : R.int(1954, 2006);
            const st = (r === 0 ? b.tn : b.bn) || (r === 0 ? b.bn : b.tn) || loc.h[0];
            const side: 0 | 1 = (r === 0 && b.tn) || (!b.tn && r === 1) ? 0 : 1;
            bl.push({
              id: bl.length,
              x,
              y,
              w,
              h,
              cx: cxx,
              cy: cyy,
              floors,
              pf,
              units: floors * pf,
              year: yr,
              cons:
                yr < 1975
                  ? 'Concrete frame, block infill'
                  : yr < 1993
                    ? 'RC frame, prefab panels'
                    : 'RC frame + shear walls',
              shelter:
                yr >= 1993
                  ? 'Safe room in each flat'
                  : R() < 0.45
                    ? 'Shared basement shelter'
                    : 'No shelter registered',
              roof: R.pick(['#cbc5ba', '#bdb6aa', '#d8d3ca', '#b6a690', '#a9a399', '#c4bdb0']),
              fac: R.pick(['#d9cfbd', '#e2dccf', '#cdbfa6', '#d4cfc6', '#bfb5a5']),
              tanks: R.int(1, Math.min(6, pf + 2)),
              street: st,
              side,
              ent: R.pick(['A', 'B']),
              num: 0,
              addr: '',
            });
          }
        }
        cx += lw;
      }
    }
  }

  const groups: Record<string, Building[]> = {};
  for (const b of bl) {
    const k = `${b.street}|${b.side}`;
    (groups[k] = groups[k] || []).push(b);
  }
  for (const k of Object.keys(groups)) {
    groups[k]
      .sort((a, b) => a.cx - b.cx)
      .forEach((b, i) => {
        b.num = b.side === 0 ? 2 + i * 2 : 1 + i * 2;
        b.addr = `${b.street} ${b.num}`;
      });
  }

  return { W, H, streets, blocks, bl, seed: loc.seed, loc };
}

export function inPoly(p: [number, number], poly: [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      (a[1] > p[1]) !== (b[1] > p[1]) &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      c = !c;
    }
  }
  return c;
}

export function covAt(ev: Pick<EventState, 'fb'>, x: number, y: number, at: number): number {
  const f = ev.fb;
  if (at < f.T0 - 2 && x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1) {
    const k = clamp(Math.floor((x - f.x0) / f.sw), 0, f.n - 1);
    const q = k % 2 === 0 ? (y - f.y0) / (f.y1 - f.y0) : (f.y1 - y) / (f.y1 - f.y0);
    return f.T0 + ((k + q) / f.n) * (f.T1 - f.T0);
  }
  for (let r = 120; ; r += 60) if (r >= at + 5) return r + 4;
}

export function rebuildHitData(ev: EventState, h: HitBuilding, newSev: SeverityKey) {
  h.sev = newSev;
  // Preserve devices & units structure, adjust structural behavior via h.sev
}

export function addHit(ev: EventState, id: number, sev: SeverityKey, at: number): HitBuilding {
  const b = ev.city.bl[id];
  const seed = ev.loc.seed * 31 + id * 7 + 1;
  const R = rng(seed);
  const cov = covAt(ev, b.cx, b.cy, at);

  const h: HitBuilding = {
    id,
    sev,
    at,
    l1: at + 0.2 + R() * 0.6,
    l2: at + 0.4 + R() * 0.9,
    l3: at + 0.7 + R() * 1.2,
    l4m: R() < 0.8 ? at + 1 + R() * 3 : null,
    l4g: Math.max(at, 25) + 1 + R() * 6,
    bpA: R() < 0.65,
    bpT: Math.max(at, 25) + 12 + R() * 80,
    resT: at + 28 + R() * 40,
    cov,
    os: null,
    oe: null,
    mr: null,
    dr: null,
    dev: [],
    units: [],
    seed,
  };

  const nd = { c: R.int(1, 6), p: R.int(0, 4), d: R.int(0, 2), n: R.int(0, 1) }[sev];
  for (let k = 0; k < nd; k++) {
    h.dev.push({
      k,
      fx: R.r(0.15, 0.85),
      fy: R.r(0.15, 0.85),
      floor: R.int(0, b.floors - 1),
      acc: R.r(1.6, 2.9),
      carrier: R.pick(CARR_IL),
      imsi: `425 0${R.int(1, 9)} ••••• ${R.int(1000, 9999)}`,
      rssi: -R.int(78, 112),
      t2: h.cov + R.r(0.5, 4),
      t3: null,
      dead: sev === 'n' ? null : R() < 0.18 ? h.cov + R.r(25, 110) : null,
      reply: sev === 'n' ? null : R() < 0.5 ? R.pick(REPLIES) : null,
      rd: R.r(2, 9),
      dx: R.r(-18, 18),
      dy: R.r(-18, 18),
    });
  }

  const pM = { c: 0.14, p: 0.07, d: 0.015, n: 0 }[sev];
  const pS = { c: 0.45, p: 0.65, d: 0.88, n: 0.96 }[sev];
  let apt = 1;
  for (let f = 0; f < b.floors; f++) {
    for (let k = 0; k < b.pf; k++) {
      const u: ResidentUnit = {
        apt: apt++,
        floor: f,
        reg: R() < 0.08 ? 0 : R.int(1, 5),
        miss: null,
        safe: null,
        hosp: null,
      };
      if (u.reg) {
        if (R() < pM) {
          u.miss = h.resT + R.r(0, 50);
          if (R() < 0.3) u.hosp = u.miss + R.r(20, 140);
        } else if (R() < pS) {
          u.safe = h.resT + R.r(2, 110);
        }
      }
      h.units.push(u);
    }
  }

  const nm = sev === 'n' ? 0 : R.int(sev === 'd' ? 0 : 1, sev === 'c' ? 4 : 3);
  const templates: [string, string, 'he' | 'ar'][] = [
    [
      'Telegram · residents group',
      'My parents live on floor {F} at {A}, apt {apt}. Their phones are off since the impact. Please check.',
      'he',
    ],
    [
      'WhatsApp tipline',
      'We hear knocking from under the rubble at {A}, back side near the parking.',
      'he',
    ],
    [
      '104 hotline list',
      'Family report: {n} residents of apt {apt} at {A} unreachable.',
      'he',
    ],
    [
      'Municipal hotline 106',
      'Elderly neighbour on floor {F} of {A} lives alone and uses a walker.',
      'he',
    ],
    [
      'X · public post',
      'Entrance {E} stairwell of {A} collapsed. People were going down to the shelter.',
      'he',
    ],
    [
      'Facebook · public post',
      'My brother is trapped with his son, floor {F} at {A}. He texted "we are under the stairs".',
      'ar',
    ],
  ];
  const missU = h.units.filter((u) => u.miss && u.reg);
  for (let i = 0; i < nm; i++) {
    const tp = R.pick(templates);
    const u = missU.length ? R.pick(missU) : R.pick(h.units);
    ev.msgs.push({
      id: ev.seq++,
      b: id,
      t: at + R.r(4, 150),
      ch: tp[0],
      lang: tp[2],
      floor: u.floor,
      apt: u.apt,
      srcs: R() < 0.35 ? 2 : 1,
      fake: false,
      txt: tp[1]
        .replace('{F}', fl(u.floor))
        .replace('{A}', b.addr)
        .replace('{apt}', String(u.apt))
        .replace('{n}', String(u.reg || 2))
        .replace('{E}', b.ent),
    });
  }

  ev.H[id] = h;
  ev.hits.push(h);
  return h;
}

export function planOrbits(ev: EventState) {
  const q = ev.hits
    .filter((h) => h.os == null)
    .sort((a, b) => SEV[b.sev].w - SEV[a.sev].w || ev.city.bl[b.id].floors - ev.city.bl[a.id].floors);
  for (const h of q) {
    const d = ev.drones.reduce((a, b) => (a.free <= b.free ? a : b));
    const R = rng(h.seed + 99);
    h.os = Math.max(d.free, h.at + 6);
    h.oe = h.os + 6;
    h.mr = h.oe + 35;
    h.dr = d.id;
    d.free = h.oe + 1;
    d.tasks.push({ b: h.id, s: h.os, e: h.oe });
    for (const v of h.dev) v.t3 = h.oe + R.r(0, 3);
  }
}

function addFakes(ev: EventState) {
  const R = rng(ev.loc.seed + 77);
  const f = ev.fb;
  const cand = ev.city.bl.filter(
    (b) => !ev.H[b.id] && b.cx > f.x0 && b.cx < f.x1 && b.cy > f.y0 && b.cy < f.y1
  );
  for (let i = 0; i < Math.min(3, cand.length); i++) {
    const b = R.pick(cand);
    ev.msgs.push({
      id: ev.seq++,
      b: b.id,
      t: R.r(8, 70),
      ch: 'X · 7 near-identical accounts',
      lang: 'he',
      floor: R.int(1, Math.max(1, b.floors - 1)),
      srcs: 1,
      fake: true,
      cov: covAt(ev, b.cx, b.cy, 0),
      txt: `URGENT, share!! 5 people trapped at ${b.addr}, floor ${R.int(1, Math.max(1, b.floors - 1))}, nobody is coming`,
    });
  }
}

export function makeEvent(
  loc: LocationPack,
  city: CityModel,
  sel: Map<number, SeverityKey>,
  poly: [number, number][] | null,
  type: EventType,
  srcIdx: number,
  bsrcIdx: number,
  dateStr: string,
  initialPriorityOrder: number[] = [],
  initialReasons: Record<number, string> = {}
): EventState {
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  for (const id of sel.keys()) {
    const b = city.bl[id];
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  x0 -= 70;
  y0 -= 70;
  x1 += 70;
  y1 += 70;
  const n = Math.max(3, Math.ceil((x1 - x0) / 70));

  const ev: EventState = {
    loc,
    city,
    type,
    srcIdx,
    bsrcIdx,
    date: new Date(dateStr),
    poly,
    H: {},
    hits: [],
    msgs: [],
    sms: {},
    ver: {},
    team: {},
    priorityOrder: [...initialPriorityOrder],
    priorityReasons: { ...initialReasons },
    seq: 0,
    fb: { x0, y0, x1, y1, n, sw: (x1 - x0) / n, T0: 18, T1: 38 },
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    drones: [
      { id: 'M-1', kind: 'Mapping drone', free: 50, tasks: [] },
      { id: 'O-1', kind: '3D orbit drone', free: 42, tasks: [] },
    ],
  };

  for (const [id, sev] of sel) addHit(ev, id, sev, 0);
  planOrbits(ev);
  addFakes(ev);
  return ev;
}

export function buildDemoEvent(): EventState {
  const loc = LOCS[0]; // Bat Yam — Ramat Yosef
  const city = genCity(loc);
  const centerB = city.bl.reduce((a, b) =>
    Math.hypot(b.cx - 600, b.cy - 400) < Math.hypot(a.cx - 600, a.cy - 400) ? b : a
  );
  const poly: [number, number][] = [...Array(7)].map((_, i) => [
    Math.round(centerB.cx + Math.cos((i / 7) * 6.283 + 0.3) * (118 + (i % 2) * 22)),
    Math.round(centerB.cy + Math.sin((i / 7) * 6.283 + 0.3) * (92 + (i % 3) * 14)),
  ]);

  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const md = Math.max(...poly.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
  const R = rng(city.seed + poly.length);
  const sel = new Map<number, SeverityKey>();

  for (const b of city.bl) {
    const pts: [number, number][] = [
      [b.cx, b.cy],
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x, b.y + b.h],
      [b.x + b.w, b.y + b.h],
    ];
    if (pts.some((p) => inPoly(p, poly))) {
      const d = Math.hypot(b.cx - cx, b.cy - cy) / md + R.r(-0.15, 0.15);
      sel.set(b.id, d < 0.38 ? 'c' : d < 0.7 ? 'p' : 'd');
    }
  }

  // Commander priority starts clean or with 2 initial sample ranks so both Ranked and "Not ranked" are immediately visible & editable
  const collapsedIds = [...sel.entries()]
    .filter(([, s]) => s === 'c')
    .map(([id]) => id);
  const initialOrder = collapsedIds.slice(0, 2);
  const initialReasons: Record<number, string> = {};
  if (initialOrder[0] != null) {
    initialReasons[initialOrder[0]] = 'Primary impact zone · heavy pancake collapse reported';
  }
  if (initialOrder[1] != null) {
    initialReasons[initialOrder[1]] = 'Multi-story structure · awaiting residents register check';
  }

  return makeEvent(
    loc,
    city,
    sel,
    poly,
    'Missile strike',
    0,
    0,
    '2026-11-20T13:29',
    initialOrder,
    initialReasons
  );
}

export const alive = (d: PhoneDevice, t: number) => !d.dead || d.dead > t;
export const loc3 = (d: PhoneDevice, t: number) => d.t3 != null && t >= d.t3 && alive(d, d.t3);

export function msgStatus(
  ev: EventState,
  m: OsintMessage,
  t: number
): ['reported' | 'supported' | 'verified' | 'flagged', string] {
  if (m.fake) {
    return m.cov != null && t >= m.cov
      ? ['flagged', 'Flagged: drone shows no damage; text cluster']
      : ['reported', 'Reported'];
  }
  if (ev.ver[m.id]) return ['verified', 'Field-verified'];
  const h = ev.H[m.b];
  if (h && h.dev.some((d) => loc3(d, t) && d.floor === m.floor)) {
    return ['supported', `Supported: phone located on floor ${fl(m.floor)}`];
  }
  if (h && t >= h.cov) return ['supported', 'Supported: drone confirms damage'];
  if (m.srcs > 1) return ['supported', 'Supported: 2 independent sources'];
  return ['reported', 'Reported'];
}

export function msgsAt(ev: EventState, t: number, bid?: number): OsintMessage[] {
  const out: OsintMessage[] = ev.msgs.filter((m) => m.t <= t && (bid == null || m.b === bid));
  for (const k of Object.keys(ev.sms)) {
    const s = ev.sms[k];
    const [bId, devIdx] = k.split('-').map(Number);
    const h = ev.H[bId];
    if (!h) continue;
    const d = h.dev[devIdx];
    if (d && d.reply && alive(d, s + 0.5) && t >= s + d.rd && (bid == null || bid === bId)) {
      out.push({
        id: `s${k}`,
        b: bId,
        t: s + d.rd,
        ch: 'SMS reply via cellular locator',
        lang: 'en',
        floor: d.floor,
        srcs: 1,
        sms: true,
        txt: d.reply.replace('{F}', fl(d.floor)),
      });
    }
  }
  return out.sort((a, b) => b.t - a.t);
}

export function resStat(h: HitBuilding, u: ResidentUnit, t: number): string | null {
  if (t < h.resT) return null;
  if (u.hosp && t >= u.hosp) return 'Located — hospital';
  if (u.safe && t >= u.safe) return 'Located — safe';
  if (u.miss && t >= u.miss) return 'Reported missing';
  return 'Unknown';
}

export function resSum(h: HitBuilding, t: number) {
  const s = { reg: 0, loc: 0, miss: 0, unk: 0 };
  for (const u of h.units) {
    s.reg += u.reg;
    const st = resStat(h, u, t);
    if (!st) continue;
    if (st.startsWith('Located')) s.loc += u.reg;
    else if (st === 'Reported missing') s.miss += u.reg;
    else s.unk += u.reg;
  }
  return s;
}

/** Commander-ordered sorting: ranked buildings first in commander order, then "Not ranked" buildings by severity/address. */
export function orderedHits(ev: EventState): HitBuilding[] {
  const rankMap = new Map<number, number>();
  ev.priorityOrder.forEach((id, idx) => rankMap.set(id, idx));
  return [...ev.hits].sort((a, b) => {
    const ra = rankMap.get(a.id);
    const rb = rankMap.get(b.id);
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return SEV[b.sev].w - SEV[a.sev].w || ev.city.bl[a.id].addr.localeCompare(ev.city.bl[b.id].addr);
  });
}

export function getBuildingRank(ev: EventState, id: number): number | null {
  const idx = ev.priorityOrder.indexOf(id);
  return idx === -1 ? null : idx + 1;
}

export const ORTHO_VERSIONS: [number, string][] = [
  [68, 'v1'],
  [128, 'v2 · refresh by team drone'],
  [188, 'v3 · refresh by team drone'],
  [248, 'v4'],
];

export function orthoV(t: number): [number, string] | null {
  let v: [number, string] | null = null;
  for (const o of ORTHO_VERSIONS) if (t >= o[0]) v = o;
  return v;
}

export function covRects(ev: EventState, t: number): [number, number, number, number][] {
  const f = ev.fb;
  if (t >= 128) return [[-60, -60, ev.city.W + 120, ev.city.H + 120]];
  if (t < f.T0) return [];
  if (t >= f.T1) return [[f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0]];
  const p = ((t - f.T0) / (f.T1 - f.T0)) * f.n;
  const k = Math.floor(p);
  const q = p - k;
  const r: [number, number, number, number][] = [];
  const hh = f.y1 - f.y0;
  for (let j = 0; j < k; j++) r.push([f.x0 + j * f.sw, f.y0, f.sw, hh]);
  if (k < f.n) {
    r.push(
      k % 2 === 0
        ? [f.x0 + k * f.sw, f.y0, f.sw, q * hh]
        : [f.x0 + k * f.sw, f.y1 - q * hh, f.sw, q * hh]
    );
  }
  return r;
}

export interface ActiveDronePos {
  id: string;
  x: number;
  y: number;
  a: 'map' | 'orb';
  b?: number;
  r?: number;
}

export function dronePos(ev: EventState, t: number): ActiveDronePos[] {
  const out: ActiveDronePos[] = [];
  const f = ev.fb;
  const C = ev.city;
  if (t >= f.T0 && t < f.T1) {
    const p = ((t - f.T0) / (f.T1 - f.T0)) * f.n;
    const k = Math.min(f.n - 1, Math.floor(p));
    const q = p - k;
    out.push({
      id: 'M-1',
      x: f.x0 + (k + 0.5) * f.sw,
      y: k % 2 === 0 ? f.y0 + q * (f.y1 - f.y0) : f.y1 - q * (f.y1 - f.y0),
      a: 'map',
    });
  }
  for (const r of [120, 180, 240]) {
    if (t >= r && t < r + 8) {
      const g = ((t - r) / 8) * 8;
      const k = Math.min(7, Math.floor(g));
      const q = g - k;
      const sw = C.W / 8;
      out.push({
        id: 'T-3',
        x: (k + 0.5) * sw,
        y: k % 2 === 0 ? q * C.H : C.H - q * C.H,
        a: 'map',
      });
    }
  }
  for (const d of ev.drones) {
    for (const k of d.tasks) {
      if (t >= k.s && t < k.e) {
        const b = C.bl[k.b];
        const rad = Math.max(b.w, b.h) * 0.85 + 10;
        const ang = (t - k.s) * 4.2;
        out.push({
          id: d.id,
          x: b.cx + Math.cos(ang) * rad,
          y: b.cy + Math.sin(ang) * rad,
          a: 'orb',
          b: k.b,
          r: rad,
        });
      }
    }
  }
  return out;
}

export function lays(ev: EventState, h: HitBuilding, t: number): LayerItem[] {
  const osintMin = Math.min(...msgsAt(ev, 1e9, h.id).map((m) => m.t), 1e9);
  const imsiMin = h.dev.length ? Math.min(...h.dev.map((d) => d.t2)) : null;

  const raw: { k: string; n: string; s: string; r: number | null; kind?: string }[] = [
    { k: 'L1', n: 'Base map and address', s: SRC_IL.base[1], r: h.l1 },
    { k: 'L2', n: 'Pre-disaster aerial', s: SRC_IL.base[ev.srcIdx].split(' (')[0], r: h.l2 },
    { k: 'L3', n: 'Footprint and floors', s: SRC_IL.b[ev.bsrcIdx], r: h.l3 },
    {
      k: 'L4',
      n: 'Street-level imagery',
      s: h.l4m ? 'Mapillary cache + Google (online)' : 'Google Street View (online only)',
      r: h.l4m || h.l4g,
      kind: 'sv',
    },
    {
      k: 'Arch',
      n: 'Plans and construction',
      s: h.bpA ? SRC_IL.arch : 'Not in archive · inferred plan',
      r: h.bpT,
      kind: 'arch',
    },
    { k: 'Res', n: 'Residents register', s: SRC_IL.res, r: h.resT, kind: 'res' },
    { k: 'L5', n: 'Drone orthophoto', s: 'M-1 mapping flight', r: Math.max(h.cov, 68) },
    {
      k: 'L6',
      n: '3D model (Gaussian splat)',
      s: `${h.dr ?? 'O-1'} orbit · field GPU`,
      r: h.mr,
      kind: '3d',
    },
    {
      k: 'L7',
      n: 'Reports (OSINT)',
      s: 'Telegram, X, tiplines, 104',
      r: osintMin < 1e8 ? osintMin : null,
    },
    {
      k: 'L8',
      n: 'Phones (IMSI)',
      s: 'Cellular locator · Phase 2',
      r: imsiMin,
    },
  ];

  return raw.map((x) => {
    const ok = x.r != null && t >= x.r;
    let status: LayerItem['status'] = 'Pending';
    if (x.r == null) {
      status = 'None';
    } else if (ok) {
      status = x.kind === 'arch' && !h.bpA ? 'Inferred' : 'Ready';
    } else if ((x.kind === 'arch' || (x.kind === 'sv' && !h.l4m)) && t < 25) {
      status = 'Needs Starlink';
    } else if (
      (x.kind === '3d' && h.os != null && t >= h.os) ||
      (x.kind === 'res' && t >= 5) ||
      (x.kind === 'arch' && t >= 25) ||
      (x.k.startsWith('L') && ['L1', 'L2', 'L3', 'L4'].includes(x.k) && t >= 0)
    ) {
      status = 'Loading';
    }
    return { k: x.k, n: x.n, s: x.s, r: x.r, ok, status };
  });
}

export function logAt(ev: EventState, t: number): { t: number; txt: string }[] {
  const C = ev.city;
  const L: [number, string][] = [
    [0, `Event opened · ${ev.type} · ${ev.hits.length} building files created`],
    [1, 'Offline layers L1 to L4 loading from the field kit'],
    [ev.fb.T0, 'M-1 launched · mapping flight started'],
    [25, 'Starlink connected · event synced to the cloud'],
    [ev.fb.T1, 'M-1 landed · orthophoto processing started'],
    [68, 'Orthophoto v1 published to all teams'],
    [110, 'Team drone T-3 joined the event'],
    [128, 'Orthophoto v2 (refresh)'],
    [188, 'Orthophoto v3 (refresh)'],
  ];

  for (const h of ev.hits) {
    const a = C.bl[h.id].addr;
    if (h.os != null) L.push([h.os, `${h.dr} orbiting ${a}`]);
    if (h.mr != null) L.push([h.mr, `3D model ready · ${a}`]);
    L.push([h.bpT, `${h.bpA ? 'Plans received' : 'No plans in archive, plan inferred'} · ${a}`]);
    L.push([h.resT, `Residents register loaded · ${a}`]);
    for (const d of h.dev) {
      L.push([d.t2, `Phone detected (2D ±20 m) near ${a}`]);
      if (d.t3 != null && alive(d, d.t3)) {
        L.push([
          d.t3,
          `Phone P${d.k + 1} located in 3D · ${a} · floor ${fl(d.floor)} · ±${d.acc.toFixed(1)} m`,
        ]);
      }
    }
  }

  for (const m of ev.msgs) {
    L.push([
      m.t,
      `${m.fake ? 'Report (suspicious cluster)' : 'Report'} · ${m.ch} → ${C.bl[m.b].addr}`,
    ]);
  }

  return L.map((x) => ({ t: x[0], txt: x[1] }))
    .filter((l) => l.t <= t)
    .sort((a, b) => b.t - a.t);
}

export function clockStr(ev: EventState, t: number): string {
  const d = new Date(ev.date.getTime() + t * 60000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())} · ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
}

export function cmodel(b: Building, h: HitBuilding) {
  const R = rng(b.id * 977 + 5);
  const F = b.floors;
  const sl: { tx: number; ty: number; dz: number; ox: number; oy: number }[] = [];
  for (let i = 0; i <= F + 1; i++) {
    sl.push({
      tx: R.r(-1, 1),
      ty: R.r(-1, 1),
      dz: R.r(0, 0.4),
      ox: R.r(-1.4, 1.4),
      oy: R.r(-1.4, 1.4),
    });
  }
  const hinge = R.r(0.35, 0.55);
  const side = R() < 0.5;

  return {
    z: (i: number, u: number, v: number) => {
      const zi = i * 3;
      const s = sl[i];
      if (h.sev === 'c') {
        return i === 0
          ? 0
          : Math.max(0, Math.min(zi, i * 0.55 + s.dz + (s.tx * (u - 0.5) + s.ty * (v - 0.5)) * 1.6));
      }
      if (h.sev === 'p') {
        const uu = side ? u : 1 - u;
        if (uu < hinge || i === 0) return zi;
        const k = Math.min(1, ((uu - hinge) / (1 - hinge)) * 1.2);
        return zi - (zi - (i * 0.6 + s.dz)) * k;
      }
      return zi;
    },
    off: (i: number): [number, number] =>
      h.sev === 'c' && i > 0 ? [sl[i].ox, sl[i].oy] : [0, 0],
    side,
    hinge,
  };
}

export function genPts(b: Building, h: HitBuilding) {
  const Wm = b.w * 0.5;
  const Dm = b.h * 0.5;
  const F = b.floors;
  const M = cmodel(b, h);
  const R = rng(b.id * 31 + h.sev.charCodeAt(0));
  const pts: [number, number, number, string][] = [];
  const nu = Math.max(4, Math.round(Wm / 1.2));
  const nv = Math.max(4, Math.round(Dm / 1.2));
  const broken = h.sev === 'c' || h.sev === 'p';
  const roofc = b.roof;
  const fac = b.fac;

  for (let i = 1; i <= F; i++) {
    if (i < F && !broken) continue;
    const [ox, oy] = M.off(i);
    for (let a = 0; a <= nu; a++) {
      for (let c = 0; c <= nv; c++) {
        const u = a / nu;
        const v = c / nv;
        pts.push([(u - 0.5) * Wm + ox, (v - 0.5) * Dm + oy, M.z(i, u, v), i === F ? roofc : '#8d877e']);
      }
    }
  }

  const per: [number, number, number][] = [];
  for (let s = 0; s < Wm; s += 1) per.push([s / Wm, 0, s]);
  for (let s = 0; s < Dm; s += 1) per.push([1, s / Dm, Wm + s]);
  for (let s = 0; s < Wm; s += 1) per.push([1 - s / Wm, 1, Wm + Dm + s]);
  for (let s = 0; s < Dm; s += 1) per.push([0, 1 - s / Dm, 2 * Wm + Dm + s]);

  for (let i = 0; i < F; i++) {
    const [o1x, o1y] = M.off(i);
    const [o2x, o2y] = M.off(i + 1);
    for (const [u, v, pp] of per) {
      for (const s of [0, 0.25, 0.5, 0.75]) {
        if (h.sev === 'd' && R() < 0.05) continue;
        const z0 = M.z(i, u, v);
        const z1 = M.z(i + 1, u, v);
        const z = z0 + (z1 - z0) * s;
        const win = (s === 0.25 || s === 0.5) && pp % 3.2 > 0.9 && pp % 3.2 < 2.3;
        let col = win ? '#3b4652' : i === 0 ? '#b9b0a0' : fac;
        if (broken && z1 - z0 < 2.2) col = win ? '#4a4640' : '#9d9483';
        pts.push([(u - 0.5) * Wm + o1x + (o2x - o1x) * s, (v - 0.5) * Dm + o1y + (o2y - o1y) * s, z, col]);
      }
    }
  }

  const RB = { c: 900, p: 380, d: 90, n: 0 }[h.sev];
  const rm = Math.max(Wm, Dm) / 2 + (h.sev === 'c' ? 7 : 4);
  for (let i = 0; i < RB; i++) {
    const a = R() * Math.PI * 2;
    const r = Math.sqrt(R()) * rm;
    let x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (h.sev === 'p') {
      const u = x / Wm + 0.5;
      if (M.side ? u < M.hinge : u > 1 - M.hinge) x = (M.side ? 1 : -1) * Math.abs(x);
    }
    pts.push([
      x,
      y,
      Math.max(0, 1 - r / rm) * R() * (h.sev === 'c' ? F * 0.7 + 2 : 2.5),
      R.pick(['#8a8174', '#9b9284', '#6f675d', '#b3a996', '#5a544c']),
    ]);
  }

  return { pts, M, Wm, Dm };
}
