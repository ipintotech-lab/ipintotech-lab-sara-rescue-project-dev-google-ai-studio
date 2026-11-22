import type { Building, CityModel, EventState, HitBuilding } from '../types/sara';
import {
  SEV,
  alive,
  clamp,
  cmodel,
  covRects,
  dronePos,
  fl,
  genPts,
  getBuildingRank,
  loc3,
  msgStatus,
  msgsAt,
  orderedHits,
  rng,
} from './engine';

const esc = (s: string | number) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));

export interface Camera3D {
  yaw: number;
  pitch: number;
  zoom: number;
  dirty: boolean;
  g?: ReturnType<typeof genPts> & { k: string };
}

export function project3D(
  c: Camera3D,
  X: number,
  Y: number,
  Z: number,
  W: number,
  H: number,
  s: number
): [number, number, number] {
  const ca = Math.cos(c.yaw);
  const sa = Math.sin(c.yaw);
  const x = X * ca - Y * sa;
  const y = X * sa + Y * ca;
  const cp = Math.cos(c.pitch);
  const sp = Math.sin(c.pitch);
  return [W / 2 + x * s, H * 0.6 - (y * sp + Z * cp) * s, y * cp - Z * sp];
}

export function svgPt(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = svg.createSVGPoint();
  p.x = clientX;
  p.y = clientY;
  const tp = p.matrixTransform(ctm.inverse());
  return { x: tp.x, y: tp.y };
}

export function bAt(city: CityModel, p: { x: number; y: number }): Building | undefined {
  return city.bl.find(
    (b) => p.x >= b.x - 2 && p.x <= b.x + b.w + 2 && p.y >= b.y - 2 && p.y <= b.y + b.h + 2
  );
}

export function fitVB(
  svg: SVGSVGElement,
  bb: [number, number, number, number]
): [number, number, number, number] {
  const W = svg.clientWidth || 800;
  const H = svg.clientHeight || 600;
  let w = bb[2] - bb[0];
  let h = bb[3] - bb[1];
  if (w / h > W / H) h = (w * H) / W;
  else w = (h * W) / H;
  const cx = (bb[0] + bb[2]) / 2;
  const cy = (bb[1] + bb[3]) / 2;
  return [cx - w / 2, cy - h / 2, w, h];
}

export function worldSVG(
  ev: EventState | null,
  city: CityModel,
  pid: string,
  bb: [number, number, number, number],
  opts: { big?: boolean } = {}
): string {
  const ins = (x: number, y: number, w: number, h: number, m = 30) =>
    x + w > bb[0] - m && x < bb[2] + m && y + h > bb[1] - m && y < bb[3] + m;

  const B = city.bl.filter((b) => ins(b.x, b.y, b.w, b.h));
  const H = ev ? ev.H : {};

  let base = `<rect x="-80" y="-80" width="${city.W + 160}" height="${city.H + 160}" fill="#8b877b"/><rect x="-80" y="-80" width="${city.W + 160}" height="${city.H + 160}" filter="url(#${pid}-n)"/>`;

  for (const b of city.blocks) {
    const rr = rng(Math.round(b.x * 7 + b.y * 13));
    if (b.park) {
      base += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#566f40" rx="3"/>`;
      if (ins(b.x, b.y, b.w, b.h, 0)) {
        for (let i = 0; i < 40; i++) {
          base += `<circle cx="${(b.x + rr() * b.w).toFixed(1)}" cy="${(b.y + rr() * b.h).toFixed(1)}" r="${rr.r(4, 9).toFixed(1)}" fill="${rr() < 0.5 ? '#3f5a30' : '#4a6838'}" stroke="#2c3f22" stroke-width=".8"/>`;
        }
      }
      continue;
    }
    base += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#a39e91" rx="2"/><rect x="${b.x + 5}" y="${b.y + 5}" width="${b.w - 10}" height="${b.h - 10}" fill="#8e8a7d"/>`;
    if (ins(b.x, b.y, b.w, b.h, 0)) {
      for (let s = b.x + 10; s < b.x + b.w - 6; s += 30) {
        if (rr() < 0.55) {
          base += `<circle cx="${s}" cy="${b.y + 3}" r="${rr.r(3.5, 6).toFixed(1)}" fill="#40592f" stroke="#2b3c20" stroke-width=".8"/>`;
        }
        if (rr() < 0.55) {
          base += `<circle cx="${s + 12}" cy="${b.y + b.h - 3}" r="${rr.r(3.5, 6).toFixed(1)}" fill="#40592f" stroke="#2b3c20" stroke-width=".8"/>`;
        }
      }
    }
  }

  for (const s of city.streets) {
    if (s.d === 'v' && s.x != null) {
      base +=
        `<rect x="${s.x - s.w / 2}" y="-80" width="${s.w}" height="${city.H + 160}" fill="#3a3c3e"/>` +
        (s.w > 20
          ? `<line x1="${s.x}" y1="-80" x2="${s.x}" y2="${city.H + 80}" stroke="#d9d3c0" stroke-width=".8" stroke-dasharray="8 8" opacity=".7"/>`
          : '');
    } else if (s.y != null) {
      base +=
        `<rect x="-80" y="${s.y - s.w / 2}" width="${city.W + 160}" height="${s.w}" fill="#3a3c3e"/>` +
        (s.w > 20
          ? `<line x1="-80" y1="${s.y}" x2="${city.W + 80}" y2="${s.y}" stroke="#d9d3c0" stroke-width=".8" stroke-dasharray="8 8" opacity=".7"/>`
          : '');
    }
    const cr = rng(Math.round((s.x || 0) * 3 + (s.y || 0) * 5 + 11));
    for (let p = -40; p < (s.d === 'v' ? city.H : city.W) + 40; p += 34) {
      if (cr() < 0.33) {
        const c = cr.pick(['#d8d8d8', '#2a2d33', '#8a1d1d', '#5b6e86', '#c9c3b5', '#1f3a5c']);
        const off = (cr() < 0.5 ? -1 : 1) * s.w * 0.25;
        if (s.d === 'v' && s.x != null) {
          base += `<rect x="${s.x + off - 2.5}" y="${p}" width="5" height="9" rx="1.2" fill="${c}"/>`;
        } else if (s.y != null) {
          base += `<rect x="${p}" y="${s.y + off - 2.5}" width="9" height="5" rx="1.2" fill="${c}"/>`;
        }
      }
    }
  }

  for (const b of B) {
    const sh = b.floors * 1.3;
    base += `<rect x="${b.x + sh * 0.7}" y="${b.y + sh}" width="${b.w}" height="${b.h}" fill="#141414" opacity=".32"/>`;
    base += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${b.roof}" stroke="#57534a" stroke-width=".7"/>`;
    base += `<rect x="${b.x + 2.5}" y="${b.y + 2.5}" width="${b.w - 5}" height="${b.h - 5}" fill="none" stroke="#999286" stroke-width=".8"/>`;
    const r = rng(b.id * 19 + 3);
    for (let k = 0; k < Math.min(4, b.tanks); k++) {
      const tx = b.x + 4 + (k % 2) * (b.w * 0.42) + r.r(0, 3);
      const ty = b.y + 4 + Math.floor(k / 2) * (b.h * 0.38) + r.r(0, 3);
      if (tx + 7 < b.x + b.w - 2 && ty + 6 < b.y + b.h - 2) {
        base += `<rect x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" width="5" height="3.5" fill="#2c3e55" transform="rotate(-12 ${tx.toFixed(1)} ${ty.toFixed(1)})"/><rect x="${(tx + 1).toFixed(1)}" y="${(ty - 2.5).toFixed(1)}" width="3" height="2" rx=".8" fill="#eceae4"/>`;
      }
    }
  }

  let now = base + `<rect x="-80" y="-80" width="${city.W + 160}" height="${city.H + 160}" fill="#c2ad8a" opacity=".1"/>`;
  if (ev) {
    now += `<circle cx="${ev.cx}" cy="${ev.cy}" r="${Math.max(ev.fb.x1 - ev.fb.x0, ev.fb.y1 - ev.fb.y0) * 0.55}" fill="url(#${pid}-dust)"/>`;
    let rub = '';
    let top = '';
    for (const h of ev.hits) {
      const b = city.bl[h.id];
      if (!ins(b.x, b.y, b.w, b.h)) continue;
      if (h.sev === 'n') continue; // No damage: intact aerial footprint
      const r = rng(b.id * 101 + 9);
      if (h.sev === 'c') {
        const e = r.int(5, 10);
        const pts: [number, number][] = [];
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const rx = b.w / 2 + e + r.r(-4, 6);
          const ry = b.h / 2 + e + r.r(-4, 6);
          pts.push([b.cx + Math.cos(a) * rx, b.cy + Math.sin(a) * ry]);
        }
        rub += `<path d="M${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join('L')}Z" fill="#8f877a"/>`;
        for (let i = 0; i < 40; i++) {
          top += `<rect x="${(b.x - 8 + r() * (b.w + 16)).toFixed(1)}" y="${(b.y - 8 + r() * (b.h + 16)).toFixed(1)}" width="${r.r(1, 3.5).toFixed(1)}" height="${r.r(1, 2.5).toFixed(1)}" fill="${r.pick(['#5f584f', '#c9c1b2', '#3b3631', '#a39886'])}"/>`;
        }
        top += `<ellipse cx="${(b.cx + r.r(-6, 6)).toFixed(1)}" cy="${(b.cy + r.r(-6, 6)).toFixed(1)}" rx="${b.w * 0.25}" ry="${b.h * 0.2}" fill="#1b1612" opacity=".55"/>`;
      } else if (h.sev === 'p') {
        const side = r() < 0.5;
        const hx = side ? b.x + b.w * 0.45 : b.x;
        const ww = b.w * 0.55 + 6;
        rub += `<rect x="${hx - 3}" y="${b.y - 5}" width="${ww}" height="${b.h + 10}" rx="6" fill="#958c7e"/>`;
        top += `<path d="M${b.x + b.w * 0.2},${b.y + 3}L${b.x + b.w * 0.35},${b.y + b.h * 0.5}L${b.x + b.w * 0.25},${b.y + b.h - 3}" stroke="#2a2522" stroke-width="1.2" fill="none"/>`;
        for (let i = 0; i < 20; i++) {
          top += `<rect x="${(hx + r() * ww).toFixed(1)}" y="${(b.y - 6 + r() * (b.h + 12)).toFixed(1)}" width="2" height="2" fill="#4c463f"/>`;
        }
      } else {
        for (let i = 0; i < 3; i++) {
          top += `<circle cx="${(b.x + r() * b.w).toFixed(1)}" cy="${(b.y + r() * b.h).toFixed(1)}" r="${r.r(3, 7).toFixed(1)}" fill="#1e1914" opacity=".55"/>`;
        }
        for (let i = 0; i < 14; i++) {
          top += `<rect x="${(b.x - 6 + r() * (b.w + 12)).toFixed(1)}" y="${(b.y - 6 + r() * (b.h + 12)).toFixed(1)}" width="2" height="1.6" fill="#5a534b"/>`;
        }
      }
    }
    now += `<g filter="url(#${pid}-rb)">${rub}</g>${top}`;
    const vr = rng(ev.loc.seed + 5);
    const vs = city.streets.filter((s) =>
      s.d === 'v' && s.x != null
        ? Math.abs(s.x - ev.cx) < 260
        : s.y != null && Math.abs(s.y - ev.cy) < 200
    );
    for (let i = 0; i < 11 && vs.length; i++) {
      const s = vr.pick(vs);
      const c = vr.pick(['#c8231d', '#f3f3f3', '#c8231d', '#2b4fa3', '#e9b200']);
      const p = s.d === 'v' ? ev.cy + vr.r(-160, 160) : ev.cx + vr.r(-200, 200);
      if (s.d === 'v' && s.x != null) {
        now += `<rect x="${s.x - 3}" y="${p.toFixed(1)}" width="6" height="14" rx="1" fill="${c}" stroke="#000" stroke-width=".4"/>`;
      } else if (s.y != null) {
        now += `<rect x="${p.toFixed(1)}" y="${s.y - 3}" width="14" height="6" rx="1" fill="${c}" stroke="#000" stroke-width=".4"/>`;
      }
    }
  }

  let vec = `<rect x="-80" y="-80" width="${city.W + 160}" height="${city.H + 160}" fill="#1a1f23"/>`;
  for (const b of city.blocks) {
    vec += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${b.park ? '#1f3024' : '#242b30'}" rx="2"/>`;
  }
  for (const s of city.streets) {
    vec +=
      s.d === 'v' && s.x != null
        ? `<rect x="${s.x - s.w / 2}" y="-80" width="${s.w}" height="${city.H + 160}" fill="#323b42"/>`
        : s.y != null
          ? `<rect x="-80" y="${s.y - s.w / 2}" width="${city.W + 160}" height="${s.w}" fill="#323b42"/>`
          : '';
  }
  for (const b of B) {
    vec += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#2f393f" stroke="#55626b" stroke-width=".8"/><text x="${b.cx}" y="${b.cy + 3}" font-size="8" text-anchor="middle" fill="#8e9aa2">${b.floors}F</text>`;
  }

  let lab = '';
  for (const s of city.streets) {
    const fs = opts.big ? 7 : 10;
    if (s.d === 'h' && s.y != null) {
      for (let x = bb[0] + 60; x < bb[2]; x += Math.max(260, (bb[2] - bb[0]) / 3)) {
        lab += `<text x="${x}" y="${s.y + 3.5}" font-size="${fs}" fill="#f4f1ea" stroke="#000" stroke-width="2.4" paint-order="stroke" opacity=".85">${esc(s.name)}</text>`;
      }
    } else if (s.x != null) {
      for (let y = bb[1] + 80; y < bb[3]; y += Math.max(240, (bb[3] - bb[1]) / 2.5)) {
        lab += `<text transform="translate(${s.x + 3.5},${y}) rotate(-90)" font-size="${fs}" fill="#f4f1ea" stroke="#000" stroke-width="2.4" paint-order="stroke" opacity=".85">${esc(s.name)}</text>`;
      }
    }
  }

  let fp = '';
  for (const b of B) {
    fp += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="#45c4ea" stroke-width=".9" opacity=".8"/><text x="${b.cx}" y="${b.cy + 3}" font-size="8" text-anchor="middle" fill="#bdeeff" stroke="#000" stroke-width="2" paint-order="stroke">${b.floors}F</text>`;
  }

  let ut = '';
  for (const s of city.streets) {
    if (s.d === 'v' && s.x != null) {
      ut += `<line x1="${s.x + s.w / 2 + 2}" y1="-80" x2="${s.x + s.w / 2 + 2}" y2="${city.H + 80}" stroke="#4aa3ff" stroke-width="1.4" stroke-dasharray="6 3"/><line x1="${s.x - s.w / 2 - 2}" y1="-80" x2="${s.x - s.w / 2 - 2}" y2="${city.H + 80}" stroke="#ff9a3c" stroke-width="1.4" stroke-dasharray="2 3"/>`;
    } else if (s.y != null) {
      ut += `<line x1="-80" y1="${s.y + s.w / 2 + 2}" x2="${city.W + 80}" y2="${s.y + s.w / 2 + 2}" stroke="#4aa3ff" stroke-width="1.4" stroke-dasharray="6 3"/><line x1="-80" y1="${s.y - s.w / 2 - 2}" x2="${city.W + 80}" y2="${s.y - s.w / 2 - 2}" stroke="#f2d14e" stroke-width="1.4" stroke-dasharray="10 4"/>`;
    }
  }
  if (ev) {
    for (const h of ev.hits) {
      const b = city.bl[h.id];
      ut += `<g transform="translate(${b.x - 4},${b.y + b.h + 4})"><rect x="-4" y="-4" width="8" height="8" fill="#ff9a3c" stroke="#000"/><text x="7" y="3" font-size="7" fill="#ffd2a8" stroke="#000" stroke-width="1.6" paint-order="stroke">gas valve</text></g>`;
    }
  }

  const poly =
    ev && ev.poly && ev.poly.length > 2
      ? `<path d="M${ev.poly.map((p) => p.join(',')).join('L')}Z" fill="#ff6a2b12" stroke="#ff6a2b" stroke-width="1.6" stroke-dasharray="7 4"/>`
      : '';

  let dmg = '';
  if (ev) {
    for (const h of ev.hits) {
      const b = city.bl[h.id];
      const dash = h.sev === 'n' ? ' stroke-dasharray="4 3"' : '';
      dmg += `<rect x="${b.x - 2}" y="${b.y - 2}" width="${b.w + 4}" height="${b.h + 4}" fill="none" stroke="${SEV[h.sev].col}" stroke-width="2"${dash}/>`;
    }
  }

  return `<defs><filter id="${pid}-n" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .75 0 0 0 -.22"/></filter>
  <filter id="${pid}-rb" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".18" numOctaves="2" seed="4" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="9" xChannelSelector="R" yChannelSelector="G"/></filter>
  <radialGradient id="${pid}-dust"><stop offset="0" stop-color="#d8c8aa" stop-opacity=".55"/><stop offset=".6" stop-color="#cbb894" stop-opacity=".2"/><stop offset="1" stop-color="#cbb894" stop-opacity="0"/></radialGradient>
  <clipPath id="${pid}-cov"></clipPath><clipPath id="${pid}-sw"><rect id="${pid}-swr" x="-100" y="-100" width="2000" height="1200"/></clipPath><g id="${pid}-base">${base}</g></defs>
  <g class="L-vec" style="display:none">${vec}</g><use class="L-pre" href="#${pid}-base"/><g class="L-now" clip-path="url(#${pid}-cov)"><g clip-path="url(#${pid}-sw)">${now}</g></g>
  <g class="L-fp" style="display:none">${fp}</g><g class="L-util" style="display:none">${ut}</g><g class="L-lab">${lab}</g><g class="L-poly">${poly}</g><g class="L-dmg">${dmg}</g><g class="dyn"></g>`;
}

export function applyWorldLayers(
  svg: SVGSVGElement,
  m: Record<string, boolean>,
  pid: string,
  ev: EventState | null,
  t: number,
  swx: number | null
) {
  for (const k of Object.keys(m)) {
    const el = svg.querySelector(`.L-${k}`) as SVGGElement | null;
    if (el) el.style.display = m[k] ? '' : 'none';
  }
  const cp = svg.querySelector(`#${pid}-cov`);
  if (cp && ev) {
    const h = covRects(ev, t)
      .map((r) => `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}"/>`)
      .join('');
    cp.innerHTML = h;
  }
  const sr = svg.querySelector(`#${pid}-swr`);
  if (sr) {
    sr.setAttribute('x', String(swx == null ? -100 : swx));
    sr.setAttribute('width', '2000');
  }
}

export function dynSVG(
  ev: EventState,
  t: number,
  k: number,
  o: {
    cov?: boolean;
    osint?: boolean;
    imsi?: boolean;
    only?: number;
    lbl?: boolean;
    badge?: boolean;
    rank?: boolean;
    teams?: boolean;
    drone?: boolean;
    swx?: number | null;
    swy?: number;
  }
): string {
  let s = '';
  const C = ev.city;
  if (o.cov && t >= ev.fb.T0 && t < ev.fb.T1) {
    for (const r of covRects(ev, t)) {
      s += `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" fill="none" stroke="#45c4ea" stroke-width="${k}" stroke-dasharray="${k * 4} ${k * 3}" opacity=".7"/>`;
    }
  }

  if (o.osint) {
    for (const m of msgsAt(ev, t)) {
      const b = C.bl[m.b];
      if (o.only != null && m.b !== o.only) continue;
      const st = m.sms ? 'supported' : msgStatus(ev, m, t)[0];
      const c = { reported: '#c7cdd2', supported: '#ff6a2b', verified: '#45c4ea', flagged: '#c0392b' }[st];
      const r = rng(String(m.id).length * 97 + (typeof m.id === 'number' ? m.id : 7));
      const x = b.x + b.w * r.r(0.15, 0.85);
      const y = b.y - 2;
      s += `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${k})"><path d="M0,0 L-5,-8 A6,6 0 1 1 5,-8 Z" fill="${c}" stroke="#000" stroke-width=".8"/>${st === 'flagged' ? '<path d="M-2.5,-12.5 L2.5,-7.5 M2.5,-12.5 L-2.5,-7.5" stroke="#fff" stroke-width="1.4"/>' : '<circle cx="0" cy="-10" r="2" fill="#111"/>'}</g>`;
    }
  }

  if (o.imsi) {
    for (const h of ev.hits) {
      if (o.only != null && h.id !== o.only) continue;
      const b = C.bl[h.id];
      let n3 = 0;
      for (const d of h.dev) {
        if (t < d.t2) continue;
        const wx = b.x + d.fx * b.w;
        const wy = b.y + d.fy * b.h;
        const al = alive(d, t);
        if (loc3(d, t)) {
          n3++;
          s += `<circle cx="${wx}" cy="${wy}" r="${d.acc * 2}" fill="#ff3fa41f" stroke="#ff3fa4" stroke-width="${k * 0.9}"/><circle cx="${wx}" cy="${wy}" r="${k * 3.8}" fill="${al ? '#ff3fa4' : '#8d4b6e'}" stroke="#fff" stroke-width="${k * 0.8}"/>`;
          if (o.lbl) {
            s += `<text x="${wx + k * 6}" y="${wy + k * 3}" font-size="${k * 9.5}" fill="#ffd0e8" stroke="#000" stroke-width="${k * 2.2}" paint-order="stroke">P${d.k + 1} · F${fl(d.floor)}</text>`;
          }
        } else {
          s += `<circle cx="${wx + d.dx}" cy="${wy + d.dy}" r="20" fill="#ff3fa414" stroke="#ff3fa4" stroke-width="${k * 0.9}" stroke-dasharray="${k * 3} ${k * 3}"/>`;
        }
      }
      if (o.badge) {
        const n = h.dev.filter((d) => t >= d.t2).length;
        if (n) {
          s += `<g transform="translate(${b.x + b.w},${b.y}) scale(${k})"><rect x="-2" y="-9" width="${n3 ? 30 : 20}" height="13" rx="6.5" fill="#ff3fa4"/><text x="3" y="1" font-size="9.5" font-weight="600" fill="#1a0010">${n3 || ''}${n3 && n > n3 ? '+' : ''}${n > n3 ? n - n3 : ''}</text></g>`;
        }
      }
    }
  }

  if (o.rank) {
    for (const h of orderedHits(ev)) {
      const b = C.bl[h.id];
      const rank = getBuildingRank(ev, h.id);
      if (rank != null) {
        s += `<g transform="translate(${b.x},${b.y}) scale(${k})"><circle r="8.5" fill="${SEV[h.sev].col}" stroke="#000"/><text y="3.5" text-anchor="middle" font-size="9.5" font-weight="700" fill="#140600">${rank}</text></g>`;
      } else {
        s += `<g transform="translate(${b.x},${b.y}) scale(${k})"><circle r="6" fill="#232a2f" stroke="${SEV[h.sev].col}" stroke-width="1.4"/><text y="3" text-anchor="middle" font-size="8" font-weight="600" fill="#e7eaec">—</text></g>`;
      }
      if (o.teams && ev.team[h.id]) {
        s += `<text transform="translate(${b.x},${b.y + b.h + k * 11}) scale(${k})" font-size="9" fill="#e7eaec" stroke="#000" stroke-width="2.2" paint-order="stroke">${esc(ev.team[h.id]!)}</text>`;
      }
    }
  }

  if (o.drone) {
    for (const d of dronePos(ev, t)) {
      if (d.a === 'orb' && d.b != null && d.r != null && (o.only == null || o.only === d.b)) {
        s += `<circle cx="${C.bl[d.b].cx}" cy="${C.bl[d.b].cy}" r="${d.r}" fill="none" stroke="#45c4ea" stroke-width="${k}" stroke-dasharray="${k * 3} ${k * 3}" opacity=".7"/>`;
      }
      s += `<g transform="translate(${d.x.toFixed(1)},${d.y.toFixed(1)}) scale(${k})"><circle r="9" fill="#45c4ea33"/><path d="M0,-7 L6,5 L0,2 L-6,5Z" fill="#45c4ea" stroke="#001820"/><text x="9" y="-6" font-size="9.5" font-weight="600" fill="#bdeeff" stroke="#000" stroke-width="2.2" paint-order="stroke">${d.id}</text></g>`;
    }
  }

  if (o.swx != null && o.swy != null) {
    s += `<line x1="${o.swx}" y1="-100" x2="${o.swx}" y2="1000" stroke="#fff" stroke-width="${k * 2}"/><g transform="translate(${o.swx},${o.swy}) scale(${k})"><circle r="13" fill="#fff"/><path d="M-4,-5 L-9,0 L-4,5 M4,-5 L9,0 L4,5" stroke="#111" stroke-width="2" fill="none"/></g>`;
  }

  return s;
}

export function facadeSVG(b: Building, w = 400, ht = 240, alt = false): string {
  const r = rng(b.id * 53 + (alt ? 9 : 1));
  const F = b.floors;
  const fw = Math.min(w * 0.58, 70 + b.w * 2.4);
  const flh = Math.min(21, (ht - 70) / F);
  const bh = flh * F + 6;
  const x0 = (w - fw) / 2;
  const gy = ht - 36;

  let s = `<defs><linearGradient id="sk${b.id}${alt ? 1 : 0}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${alt ? '#7fb2de' : '#9bbad3'}"/><stop offset="1" stop-color="${alt ? '#d9e8f2' : '#e8ecec'}"/></linearGradient></defs><rect width="${w}" height="${ht}" fill="url(#sk${b.id}${alt ? 1 : 0})"/>`;

  const nb = (x: number, ww: number, hh: number, c: string) => {
    s += `<rect x="${x}" y="${gy - hh}" width="${ww}" height="${hh}" fill="${c}"/>`;
    for (let yy = gy - hh + 8; yy < gy - 14; yy += 18) {
      for (let xx = x + 6; xx < x + ww - 10; xx += 18) {
        s += `<rect x="${xx}" y="${yy}" width="9" height="9" fill="#5d6a75" opacity=".8"/>`;
      }
    }
  };
  nb(-10, x0 - 4, r.int(70, 150), '#c8bfb0');
  nb(x0 + fw + 4, w - x0 - fw + 10, r.int(60, 150), '#d2cbbe');

  s += `<rect x="${x0}" y="${gy - bh}" width="${fw}" height="${bh}" fill="${b.fac}"/><rect x="${x0 - 3}" y="${gy - bh - 4}" width="${fw + 6}" height="5" fill="#a59c8c"/>`;
  for (let k = 0; k < Math.min(4, b.tanks); k++) {
    s += `<rect x="${x0 + 10 + k * 16}" y="${gy - bh - 14}" width="12" height="8" fill="#2b3a4f" transform="skewX(-20)"/><rect x="${x0 + 12 + k * 16}" y="${gy - bh - 20}" width="9" height="5" rx="2" fill="#ecebe6"/>`;
  }

  const cols = Math.max(3, Math.round(fw / 26));
  const cw = fw / cols;
  for (let f = 0; f < F; f++) {
    const y = gy - (f + 1) * flh;
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * cw;
      if (f === 0 && r() < 0.6) {
        s += `<rect x="${x + 2}" y="${y + 3}" width="${cw - 4}" height="${flh - 3}" fill="#2f3a44"/>`;
        continue;
      }
      s += `<rect x="${x + cw * 0.22}" y="${y + flh * 0.2}" width="${cw * 0.56}" height="${flh * 0.5}" fill="${r() < 0.25 ? '#e8d9a8' : '#4d5b67'}"/>`;
      if (c % 2 === 1 && f > 0) {
        s += `<rect x="${x + 2}" y="${y + flh * 0.72}" width="${cw - 4}" height="${flh * 0.26}" fill="#ffffff55" stroke="#776f62" stroke-width=".8"/>`;
      }
    }
  }
  s += `<rect x="${x0 + fw / 2 - 9}" y="${gy - flh + 2}" width="18" height="${flh - 2}" fill="#5a4636"/><text x="${x0 + fw / 2}" y="${gy - flh - 2}" font-size="8" text-anchor="middle" fill="#333">${b.num}</text>`;
  s += `<rect y="${gy}" width="${w}" height="10" fill="#b2ab9e"/><rect y="${gy + 10}" width="${w}" height="${ht - gy}" fill="#45484b"/><line x1="0" y1="${gy + 24}" x2="${w}" y2="${gy + 24}" stroke="#ddd" stroke-dasharray="14 10"/>`;
  s += `<rect x="${r.int(20, 300)}" y="${gy + 12}" width="44" height="13" rx="4" fill="${r.pick(['#8a1d1d', '#d8d8d8', '#1f3a5c'])}"/><circle cx="${r.int(30, 370)}" cy="${gy - 30}" r="${r.int(16, 26)}" fill="#4a6838"/>`;
  return s;
}

export function planSVG(b: Building, h: HitBuilding, f: number, t: number): string {
  const W = 380;
  const Hh = 250;
  const sc = Math.min((W - 80) / (b.w * 0.5), (Hh - 80) / (b.h * 0.5));
  const pw = b.w * 0.5 * sc;
  const ph = b.h * 0.5 * sc;
  const ox = (W - pw) / 2;
  const oy = (Hh - ph) / 2 + 4;
  const ln = '#a8def2';

  let s = `<defs><pattern id="gp" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#1f4558" stroke-width=".6"/></pattern><pattern id="ht" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line y2="5" stroke="#ff6a2b" stroke-width="1.2"/></pattern></defs><rect width="${W}" height="${Hh}" fill="#0f2a38"/><rect width="${W}" height="${Hh}" fill="url(#gp)"/>`;

  const n1 = Math.ceil(b.pf / 2);
  const n2 = b.pf - n1;
  const cor = ph * 0.16;
  const uh = (ph - cor) / 2;
  const mm = b.shelter.startsWith('Safe');

  s += `<rect x="${ox}" y="${oy}" width="${pw}" height="${ph}" fill="none" stroke="${ln}" stroke-width="3"/>`;
  const unit = (x: number, y: number, w: number, hh: number, apt: number) => {
    s += `<rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="none" stroke="${ln}" stroke-width="1.2"/><text x="${x + w / 2}" y="${y + hh / 2 + 4}" font-size="11" text-anchor="middle" fill="${ln}">Apt ${apt}</text>`;
    if (mm) {
      s += `<rect x="${x + 3}" y="${y + 3}" width="${Math.min(22, w * 0.3)}" height="${Math.min(16, hh * 0.35)}" fill="#a8def222" stroke="${ln}" stroke-width="1.6"/><text x="${x + 5}" y="${y + 13}" font-size="7" fill="${ln}">MMD</text>`;
    }
  };

  for (let k = 0; k < n1; k++) unit(ox + (k * pw) / n1, oy, pw / n1, uh, f * b.pf + k + 1);
  for (let k = 0; k < n2; k++) {
    unit(ox + (k * pw) / Math.max(1, n2), oy + uh + cor, pw / Math.max(1, n2), uh, f * b.pf + n1 + k + 1);
  }

  const cw = pw * 0.16;
  s += `<rect x="${ox + pw / 2 - cw / 2}" y="${oy + uh - 6}" width="${cw}" height="${cor + 12}" fill="#0f2a38" stroke="${ln}" stroke-width="1.4"/>`;
  for (let i = 1; i < 6; i++) {
    s += `<line x1="${ox + pw / 2 - cw / 2 + (i * cw) / 6}" y1="${oy + uh - 4}" x2="${ox + pw / 2 - cw / 2 + (i * cw) / 6}" y2="${oy + uh + cor + 4}" stroke="${ln}" stroke-width=".7"/>`;
  }
  s += `<text x="${ox + pw / 2}" y="${oy + uh + cor + 22}" font-size="8" text-anchor="middle" fill="${ln}">stairs · entrance ${b.ent}</text>`;
  s += `<line x1="${ox}" y1="${oy - 12}" x2="${ox + pw}" y2="${oy - 12}" stroke="${ln}" stroke-width=".8"/><text x="${ox + pw / 2}" y="${oy - 16}" font-size="10" text-anchor="middle" fill="${ln}">${(b.w * 0.5).toFixed(1)} m</text><text transform="translate(${ox - 14},${oy + ph / 2}) rotate(-90)" font-size="10" text-anchor="middle" fill="${ln}">${(b.h * 0.5).toFixed(1)} m</text>`;
  s += `<g transform="translate(${W - 22},26)"><path d="M0,-12 L5,4 L0,0 L-5,4Z" fill="${ln}"/><text y="16" font-size="9" text-anchor="middle" fill="${ln}">N</text></g>`;

  if ((h.sev === 'c' || h.sev === 'p') && f > 0) {
    const M = cmodel(b, h);
    const zz = M.z(f, 0.5, 0.5);
    if (zz < f * 3 - 0.5) {
      s += `<rect x="${ox}" y="${oy}" width="${h.sev === 'c' ? pw : pw * 0.5}" height="${ph}" ${h.sev === 'p' && !M.side ? `transform="translate(${pw * 0.5},0)"` : ''} fill="url(#ht)" opacity=".55"/><text x="${ox + 6}" y="${oy + ph - 6}" font-size="10" fill="#ffb38a">Slab displaced, now ≈${zz.toFixed(1)} m above ground</text>`;
    }
  }

  for (const d of h.dev) {
    if (d.floor === f && loc3(d, t)) {
      const x = ox + d.fx * pw;
      const y = oy + d.fy * ph;
      s += `<circle cx="${x}" cy="${y}" r="${d.acc * sc}" fill="#ff3fa425" stroke="#ff3fa4"/><circle cx="${x}" cy="${y}" r="4.5" fill="#ff3fa4" stroke="#fff"/><text x="${x + 7}" y="${y - 6}" font-size="10" fill="#ffd0e8">P${d.k + 1}</text>`;
    }
  }

  return s;
}

export function draw3DB(
  x: CanvasRenderingContext2D,
  W: number,
  H: number,
  c: Camera3D,
  b: Building,
  h: HitBuilding,
  t: number,
  showPhones: boolean
) {
  const key = `${b.id}-${h.sev}`;
  if (!c.g || c.g.k !== key) {
    c.g = { ...genPts(b, h), k: key };
  }
  const g = c.g;
  const s = (Math.min(W, H) / (Math.max(g.Wm, g.Dm, b.floors * 3) * 1.9)) * c.zoom;
  const gr = Math.max(g.Wm, g.Dm) * 0.9 + 6;

  x.fillStyle = '#1d2327';
  x.beginPath();
  (
    [
      [-gr, -gr],
      [gr, -gr],
      [gr, gr],
      [-gr, gr],
    ] as [number, number][]
  ).forEach((p, i) => {
    const q = project3D(c, p[0], p[1], 0, W, H, s);
    if (i) x.lineTo(q[0], q[1]);
    else x.moveTo(q[0], q[1]);
  });
  x.fill();

  x.strokeStyle = '#2a3137';
  x.lineWidth = 1;
  for (let k = -gr; k <= gr; k += 4) {
    let a = project3D(c, k, -gr, 0, W, H, s);
    let e = project3D(c, k, gr, 0, W, H, s);
    x.beginPath();
    x.moveTo(a[0], a[1]);
    x.lineTo(e[0], e[1]);
    x.stroke();
    a = project3D(c, -gr, k, 0, W, H, s);
    e = project3D(c, gr, k, 0, W, H, s);
    x.beginPath();
    x.moveTo(a[0], a[1]);
    x.lineTo(e[0], e[1]);
    x.stroke();
  }

  const pr = g.pts.map((p) => {
    const q = project3D(c, p[0], p[1], p[2], W, H, s);
    return [q[0], q[1], q[2], p[3]] as [number, number, number, string];
  });
  pr.sort((a, b2) => b2[2] - a[2]);
  const ps = Math.max(1.6, s * 0.95);
  for (const q of pr) {
    x.fillStyle = q[3];
    x.fillRect(q[0] - ps / 2, q[1] - ps / 2, ps, ps);
  }

  if (!showPhones) return;
  x.font = '600 12px "IBM Plex Sans", sans-serif';
  for (const d of h.dev) {
    if (t < d.t2) continue;
    const X = (d.fx - 0.5) * g.Wm;
    const Y = (d.fy - 0.5) * g.Dm;
    if (loc3(d, t)) {
      const [ox, oy] = g.M.off(d.floor);
      const z = g.M.z(d.floor, d.fx, d.fy) + 0.8;
      const q = project3D(c, X + ox, Y + oy, z, W, H, s);
      const q0 = project3D(c, X + ox, Y + oy, 0, W, H, s);
      x.setLineDash([3, 3]);
      x.strokeStyle = '#ff3fa4aa';
      x.beginPath();
      x.moveTo(q[0], q[1]);
      x.lineTo(q0[0], q0[1]);
      x.stroke();
      x.setLineDash([]);

      const gl = x.createRadialGradient(q[0], q[1], 0, q[0], q[1], d.acc * s + 6);
      gl.addColorStop(0, '#ff3fa4cc');
      gl.addColorStop(1, '#ff3fa400');
      x.fillStyle = gl;
      x.beginPath();
      x.arc(q[0], q[1], d.acc * s + 6, 0, Math.PI * 2);
      x.fill();

      x.fillStyle = alive(d, t) ? '#ff3fa4' : '#8a4a6a';
      x.strokeStyle = '#fff';
      x.beginPath();
      x.arc(q[0], q[1], 5, 0, Math.PI * 2);
      x.fill();
      x.stroke();

      const lb = `P${d.k + 1} · F${fl(d.floor)} · now ${z.toFixed(1)} m · ±${d.acc.toFixed(1)} m`;
      x.lineWidth = 3;
      x.strokeStyle = '#000';
      x.strokeText(lb, q[0] + 9, q[1] - 7);
      x.fillStyle = '#ffd6ea';
      x.fillText(lb, q[0] + 9, q[1] - 7);
      x.lineWidth = 1;
    } else {
      const X2 = X + d.dx * 0.5;
      const Y2 = Y + d.dy * 0.5;
      const a = project3D(c, X2, Y2, 0, W, H, s);
      const e = project3D(c, X2, Y2, b.floors * 3 + 4, W, H, s);
      x.setLineDash([4, 4]);
      x.strokeStyle = '#ff3fa4';
      x.beginPath();
      x.moveTo(a[0], a[1]);
      x.lineTo(e[0], e[1]);
      x.stroke();
      x.setLineDash([]);
    }
  }
}

export function draw3DA(
  x: CanvasRenderingContext2D,
  W: number,
  H: number,
  c: Camera3D,
  ev: EventState,
  t: number
) {
  const C = ev.city;
  const ox = ev.cx;
  const oy = ev.cy;
  const s = (Math.min(W, H) / 360) * c.zoom;
  const gr = 220;

  x.fillStyle = '#181c20';
  x.beginPath();
  (
    [
      [-gr, -gr],
      [gr, -gr],
      [gr, gr],
      [-gr, gr],
    ] as [number, number][]
  ).forEach((p, i) => {
    const q = project3D(c, p[0], p[1], 0, W, H, s);
    if (i) x.lineTo(q[0], q[1]);
    else x.moveTo(q[0], q[1]);
  });
  x.fill();

  for (const st of C.streets) {
    if (st.d === 'v' && st.x != null) {
      if (Math.abs(st.x - ox) * 0.5 > gr) continue;
      const a = project3D(c, (st.x - ox) * 0.5, -gr, 0, W, H, s);
      const e = project3D(c, (st.x - ox) * 0.5, gr, 0, W, H, s);
      x.strokeStyle = '#323a40';
      x.lineWidth = st.w * 0.5 * s;
      x.beginPath();
      x.moveTo(a[0], a[1]);
      x.lineTo(e[0], e[1]);
      x.stroke();
    } else if (st.y != null) {
      if (Math.abs(st.y - oy) * 0.5 > gr) continue;
      const a = project3D(c, -gr, -(st.y - oy) * 0.5, 0, W, H, s);
      const e = project3D(c, gr, -(st.y - oy) * 0.5, 0, W, H, s);
      x.strokeStyle = '#323a40';
      x.lineWidth = st.w * 0.5 * s;
      x.beginPath();
      x.moveTo(a[0], a[1]);
      x.lineTo(e[0], e[1]);
      x.stroke();
    }
  }
  x.lineWidth = 1;

  if (ev.poly && ev.poly.length > 2) {
    x.strokeStyle = '#ff6a2b';
    x.setLineDash([5, 4]);
    x.beginPath();
    ev.poly.forEach((p, i) => {
      const q = project3D(c, (p[0] - ox) * 0.5, -(p[1] - oy) * 0.5, 0, W, H, s);
      if (i) x.lineTo(q[0], q[1]);
      else x.moveTo(q[0], q[1]);
    });
    x.closePath();
    x.stroke();
    x.setLineDash([]);
  }

  const B = C.bl.filter((b) => Math.hypot(b.cx - ox, b.cy - oy) < 420);
  const ca = Math.cos(c.yaw);
  const sa = Math.sin(c.yaw);
  const faces: { q: [number, number, number][]; d: number; f: string }[] = [];

  const hex = (h: string, k: number) => {
    const n = parseInt(h.slice(1), 16);
    return `rgb(${Math.min(255, ((n >> 16) & 255) * k) | 0},${Math.min(255, ((n >> 8) & 255) * k) | 0},${Math.min(255, (n & 255) * k) | 0})`;
  };

  for (const b of B) {
    const h = ev.H[b.id];
    const x0 = (b.x - ox) * 0.5;
    const x1 = (b.x + b.w - ox) * 0.5;
    const y0 = -(b.y - oy) * 0.5;
    const y1 = -(b.y + b.h - oy) * 0.5;
    const z = h
      ? h.sev === 'c'
        ? 2.4
        : h.sev === 'p'
          ? b.floors * 3 * 0.55
          : b.floors * 3
      : b.floors * 3;
    const col = h ? SEV[h.sev].col : '#7d878f';
    const C4: [number, number][] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    const N: [number, number][] = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];

    for (let i = 0; i < 4; i++) {
      const n = N[i];
      const ny = n[0] * sa + n[1] * ca;
      if (ny >= 0) continue;
      const a = C4[i];
      const e = C4[(i + 1) % 4];
      const nx = n[0] * ca - n[1] * sa;
      const lt = 0.5 + 0.35 * Math.max(0, -nx * 0.6 - ny * 0.5);
      const q = [
        project3D(c, a[0], a[1], 0, W, H, s),
        project3D(c, e[0], e[1], 0, W, H, s),
        project3D(c, e[0], e[1], z, W, H, s),
        project3D(c, a[0], a[1], z, W, H, s),
      ];
      faces.push({ q, d: (q[0][2] + q[1][2]) / 2, f: hex(col, lt * (h ? 0.9 : 0.75)) });
    }
    const qTop = C4.map((p) => project3D(c, p[0], p[1], z, W, H, s));
    faces.push({
      q: qTop,
      d: qTop.reduce((a, b2) => a + b2[2], 0) / 4 - 0.01,
      f: hex(col, h ? 1.05 : 0.95),
    });
  }

  faces.sort((a, b) => b.d - a.d);
  for (const fc of faces) {
    x.fillStyle = fc.f;
    x.beginPath();
    fc.q.forEach((p, i) => {
      if (i) x.lineTo(p[0], p[1]);
      else x.moveTo(p[0], p[1]);
    });
    x.closePath();
    x.fill();
    x.strokeStyle = '#0006';
    x.stroke();
  }

  x.font = '600 12px "IBM Plex Sans", sans-serif';
  for (const h of ev.hits) {
    const b = C.bl[h.id];
    const M = cmodel(b, h);
    for (const d of h.dev) {
      if (!loc3(d, t)) continue;
      const [o1, o2] = M.off(d.floor);
      const q = project3D(
        c,
        (b.x + d.fx * b.w - ox) * 0.5 + o1,
        -(b.y + d.fy * b.h - oy) * 0.5 - o2,
        M.z(d.floor, d.fx, d.fy) + 0.8,
        W,
        H,
        s
      );
      x.fillStyle = '#ff3fa4';
      x.strokeStyle = '#fff';
      x.beginPath();
      x.arc(q[0], q[1], 4.5, 0, Math.PI * 2);
      x.fill();
      x.stroke();
    }
  }

  const ordered = orderedHits(ev);
  ordered.slice(0, 8).forEach((h) => {
    const b = C.bl[h.id];
    const rank = getBuildingRank(ev, h.id);
    const q = project3D(c, (b.cx - ox) * 0.5, -(b.cy - oy) * 0.5, b.floors * 3 + 5, W, H, s);
    const label = rank != null ? `#${rank} · ${b.addr}` : `Not ranked · ${b.addr}`;
    x.lineWidth = 3;
    x.strokeStyle = '#000';
    x.strokeText(label, q[0] - 20, q[1]);
    x.fillStyle = rank != null ? '#fff' : '#929ba2';
    x.fillText(label, q[0] - 20, q[1]);
    x.lineWidth = 1;
  });
}
