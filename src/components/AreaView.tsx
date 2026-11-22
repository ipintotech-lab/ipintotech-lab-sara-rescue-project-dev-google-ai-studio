import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Layers, Maximize2, Minus, Plus } from 'lucide-react';
import type {
  AreaLayersToggle,
  AreaMode,
  AreaTab,
  Building,
  EventState,
  MeetSpaceItem,
  OsintMessage,
  PickedDriveFile,
  ReportFilter,
  SeverityKey,
} from '../types/sara';
import {
  SEV,
  SRC_IL,
  alive,
  clamp,
  dronePos,
  fT,
  fl,
  getBuildingRank,
  lays,
  loc3,
  logAt,
  msgStatus,
  msgsAt,
  orderedHits,
  orthoV,
  resSum,
} from '../sim/engine';
import {
  applyWorldLayers,
  bAt,
  draw3DA,
  dynSVG,
  facadeSVG,
  fitVB,
  svgPt,
  worldSVG,
} from '../sim/renderers';
import { Canvas3DView } from './Canvas3DView';
import { GoogleAreaMap } from './GoogleMapsPanes';
import { GoogleSignInButton } from './GoogleSignInButton';
import { SeverityChip, SimulatedBadge, StatusChip } from './StatusChip';

interface AreaViewProps {
  ev: EventState;
  t: number;
  driveNeedsAuth: boolean;
  driveSigningIn: boolean;
  drivePicking: boolean;
  driveFiles: PickedDriveFile[];
  meetSpaces: MeetSpaceItem[];
  onGoogleSignIn: () => void;
  onOpenPicker: (buildingId?: number | null) => void;
  onOpenDriveDrawer: () => void;
  onOpenMeetDrawer: () => void;
  onOpenBuilding: (id: number) => void;
  onAddBuilding: (id: number, sev: SeverityKey) => void;
  onAssignTeam: (id: number, team: string | null) => void;
  onSendSms: (buildingId: number, devIndex: number) => void;
  onSendSmsAll: () => void;
  onVerifyMsg: (msgId: number | string) => void;
  onRankBuilding: (id: number) => void;
  onUnrankBuilding: (id: number) => void;
  onMoveRank: (id: number, dir: -1 | 1) => void;
  onSetRankReason: (id: number, reason: string) => void;
  onClearRanks: () => void;
}

const LAYER_DEFS: [keyof AreaLayersToggle, string, string][] = [
  ['fp', 'Footprints + floors (L3)', '#45c4ea'],
  ['util', 'Utilities (water, power, gas)', '#4aa3ff'],
  ['poly', 'Event polygon', '#ff6a2b'],
  ['dmg', 'Damage outline', '#ff4d2e'],
  ['imsi', 'Phones (IMSI)', '#ff3fa4'],
  ['osint', 'Reports (OSINT)', '#c7cdd2'],
  ['drone', 'Drones + coverage', '#45c4ea'],
  ['teams', 'Team assignments', '#e7eaec'],
];

const TABS: [AreaTab, string][] = [
  ['prio', 'Priority'],
  ['phones', 'Phones'],
  ['rep', 'Reports'],
  ['res', 'Residents'],
  ['inv', 'Buildings'],
  ['assets', 'Assets'],
  ['log', 'Log'],
];

export function AreaView({
  ev,
  t,
  driveNeedsAuth,
  driveSigningIn,
  drivePicking,
  driveFiles,
  meetSpaces,
  onGoogleSignIn,
  onOpenPicker,
  onOpenDriveDrawer,
  onOpenMeetDrawer,
  onOpenBuilding,
  onAddBuilding,
  onAssignTeam,
  onSendSms,
  onSendSmsAll,
  onVerifyMsg,
  onRankBuilding,
  onUnrankBuilding,
  onMoveRank,
  onSetRankReason,
  onClearRanks,
}: AreaViewProps) {
  const [amode, setAmode] = useState<AreaMode>('now');
  const [tab, setTab] = useState<AreaTab>('prio');
  const [repFilter, setRepFilter] = useState<ReportFilter>('all');
  const [mobilePane, setMobilePane] = useState<'map' | 'side'>('map');
  const [layersOpen, setLayersOpen] = useState(false);
  const [layers, setLayers] = useState<AreaLayersToggle>({
    fp: false,
    util: false,
    poly: true,
    dmg: true,
    imsi: true,
    osint: true,
    drone: true,
    teams: true,
  });

  const [vb, setVb] = useState<[number, number, number, number] | null>(null);
  const [swipeX, setSwipeX] = useState<number>(ev.cx);
  const [hoverB, setHoverB] = useState<Building | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [addPopup, setAddPopup] = useState<{
    b: Building;
    x: number;
    y: number;
    sev: SeverityKey;
  } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const mapBoxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    vb: [number, number, number, number];
    moved: boolean;
    swiping: boolean;
  } | null>(null);

  // Initialize SVG map when event or hits count changes
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.innerHTML = worldSVG(ev, ev.city, 'a', [0, 0, ev.city.W, ev.city.H]);
    if (!vb) {
      const f = ev.fb;
      const fitted = fitVB(svg, [f.x0 - 40, f.y0 - 40, f.x1 + 40, f.y1 + 40]);
      setVb(fitted);
      svg.setAttribute('viewBox', fitted.join(' '));
    }
  }, [ev, ev.hits.length]);

  // Reset viewBox when event changes location/date
  useEffect(() => {
    const svg = svgRef.current;
    setSwipeX(ev.cx);
    if (svg) {
      const f = ev.fb;
      const fitted = fitVB(svg, [f.x0 - 40, f.y0 - 40, f.x1 + 40, f.y1 + 40]);
      setVb(fitted);
      svg.setAttribute('viewBox', fitted.join(' '));
    } else {
      setVb(null);
    }
  }, [ev.loc.id, ev.date]);

  // Update SVG layers & dynamic overlays
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || amode === '3d' || amode === 'gmap') return;
    const activeVb =
      vb || fitVB(svg, [ev.fb.x0 - 40, ev.fb.y0 - 40, ev.fb.x1 + 40, ev.fb.y1 + 40]);
    svg.setAttribute('viewBox', activeVb.join(' '));
    applyWorldLayers(
      svg,
      {
        vec: amode === 'gis',
        pre: amode !== 'gis',
        now: amode === 'now' || amode === 'swipe',
        fp: layers.fp || amode === 'gis',
        util: layers.util,
        poly: layers.poly,
        dmg: layers.dmg,
        lab: true,
      },
      'a',
      ev,
      t,
      amode === 'swipe' ? swipeX : null
    );
    const dyn = svg.querySelector('.dyn');
    if (dyn) {
      const k = activeVb[2] / (svg.clientWidth || 900);
      dyn.innerHTML = dynSVG(ev, t, k, {
        cov: layers.drone,
        osint: layers.osint,
        imsi: layers.imsi,
        badge: true,
        rank: true,
        teams: layers.teams,
        drone: layers.drone,
        swx: amode === 'swipe' ? swipeX : null,
        swy: activeVb[1] + activeVb[3] / 2,
      });
    }
  }, [ev, t, amode, layers, vb, swipeX, ev.priorityOrder, ev.team, ev.ver, ev.sms, ev.hits.length]);

  const kpis = useMemo(() => {
    const H = ev.hits;
    const n = (k: SeverityKey) => H.filter((h) => h.sev === k).length;
    const dv = H.flatMap((h) => h.dev);
    const l3 = dv.filter((d) => loc3(d, t)).length;
    const d2 = dv.filter((d) => t >= d.t2).length;
    const M = msgsAt(ev, t);
    const sup = M.filter(
      (m) => m.sms || ['supported', 'verified'].includes(msgStatus(ev, m, t)[0])
    ).length;
    const rs = H.reduce(
      (a, h) => {
        const s = resSum(h, t);
        a.m += s.miss;
        a.u += s.unk;
        return a;
      },
      { m: 0, u: 0 }
    );
    const comp = Math.round(
      (H.reduce((a, h) => a + lays(ev, h, t).filter((x) => x.ok).length / 10, 0) /
        Math.max(1, H.length)) *
        100
    );
    const cv =
      t < ev.fb.T0
        ? 0
        : t >= ev.fb.T1
          ? 100
          : Math.round(((t - ev.fb.T0) / (ev.fb.T1 - ev.fb.T0)) * 100);

    return [
      {
        val: String(H.length),
        lbl: `buildings marked · ${n('c')} collapsed, ${n('p')} partial`,
        tag: 'Simulated',
      },
      {
        val: `${l3} / ${d2}`,
        lbl: 'phones located in 3D / detected',
        tag: 'Phase 2 · Simulated',
      },
      {
        val: `${sup} / ${M.length}`,
        lbl: 'reports supported / received',
        tag: 'Simulated',
      },
      {
        val: t < Math.min(...H.map((h) => h.resT)) ? '—' : String(rs.m),
        lbl: `residents reported missing · ${rs.u} unknown`,
        tag: 'Simulated',
      },
      {
        val: `${comp}%`,
        lbl: 'building files complete (avg)',
        tag: 'Simulated',
      },
      {
        val: `${cv}%`,
        lbl: 'drone coverage of event area',
        tag: 'Simulated',
      },
    ];
  }, [ev, t]);

  const ov = orthoV(t);
  const statusBanner = useMemo(() => {
    const f = ev.fb;
    if (amode === 'pre') return `Pre-disaster aerial · ${SRC_IL.base[ev.srcIdx]}`;
    if (amode === 'gis') return `GIS map · ${SRC_IL.b[ev.bsrcIdx]}`;
    if (amode === 'gmap')
      return 'Google Maps · simulated C2 buildings, priority & IMSI overlays (Demo only)';
    if (amode === '3d')
      return '3D area context (L6b) · drag to rotate, scroll/pinch to zoom. Phones shown as magenta points.';
    if (t < f.T0) return `Mapping drone launches at ${fT(f.T0)} · showing pre-disaster aerial`;
    if (t < f.T1)
      return `Live preview · mapping flight ${Math.round(((t - f.T0) / (f.T1 - f.T0)) * 100)}%`;
    if (!ov)
      return `Orthophoto processing on field GPU ${Math.round(((t - f.T1) / (68 - f.T1)) * 100)}%`;
    return `Drone orthophoto ${ov[1]} · ${fT(ov[0])}`;
  }, [amode, ev, t, ov]);

  const ordered = useMemo(() => orderedHits(ev), [ev, ev.priorityOrder, ev.hits.length]);
  const rankedList = useMemo(
    () => ordered.filter((h) => getBuildingRank(ev, h.id) != null),
    [ordered, ev]
  );
  const unrankedList = useMemo(
    () => ordered.filter((h) => getBuildingRank(ev, h.id) == null),
    [ordered, ev]
  );

  const zoomMap = (factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    if (factor === 0) {
      const f = ev.fb;
      setVb(fitVB(svg, [f.x0 - 40, f.y0 - 40, f.x1 + 40, f.y1 + 40]));
      return;
    }
    const cur = vb || fitVB(svg, [ev.fb.x0 - 40, ev.fb.y0 - 40, ev.fb.x1 + 40, ev.fb.y1 + 40]);
    const w = clamp(cur[2] / factor, 120, 2400);
    const h = cur[3] * (w / cur[2]);
    setVb([cur[0] + (cur[2] - w) / 2, cur[1] + (cur[3] - h) / 2, w, h]);
  };

  return (
    <div className="flex flex-col h-full min-h-0 pb-14 md:pb-0">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 border-b border-[#2c3338] bg-[#15191c] shrink-0">
        {kpis.map((k, idx) => (
          <div
            key={idx}
            className="px-3.5 py-2.5 border-r border-b lg:border-b-0 border-[#2c3338] last:border-r-0"
          >
            <div className="flex items-baseline justify-between gap-2">
              <b className="font-cond text-xl md:text-2xl font-semibold text-[#e7eaec] tabular-nums leading-none">
                {k.val}
              </b>
              <span className="text-[10.5px] text-[#929ba2] whitespace-nowrap">{k.tag}</span>
            </div>
            <span className="block text-xs text-[#929ba2] mt-1 leading-snug">{k.lbl}</span>
          </div>
        ))}
      </div>

      {/* Mobile Map / Console Switcher */}
      <div className="lg:hidden flex items-center justify-between gap-2 px-3 py-2 bg-[#15191c] border-b border-[#2c3338] shrink-0">
        <div className="inline-flex border border-[#2c3338] rounded-md overflow-hidden bg-[#1b2024] w-full">
          <button
            type="button"
            onClick={() => setMobilePane('map')}
            className={`flex-1 min-h-[40px] text-xs font-medium border-r border-[#2c3338] ${
              mobilePane === 'map'
                ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                : 'text-[#929ba2]'
            }`}
          >
            Map & 3D
          </button>
          <button
            type="button"
            onClick={() => setMobilePane('side')}
            className={`flex-1 min-h-[40px] text-xs font-medium ${
              mobilePane === 'side'
                ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                : 'text-[#929ba2]'
            }`}
          >
            Console ({TABS.find(([k]) => k === tab)?.[1]})
          </button>
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_430px] flex-1 min-h-0">
        {/* Left: Map / 3D Viewport */}
        <div
          ref={mapBoxRef}
          className={`relative bg-[#0b0d0f] overflow-hidden min-h-[420px] h-[62vh] lg:h-full ${
            mobilePane === 'side' ? 'hidden lg:block' : 'block'
          }`}
        >
          {/* Mode Bar */}
          <div className="absolute top-2.5 left-2.5 right-2.5 z-10 flex items-start justify-between gap-2 pointer-events-none">
            <div className="pointer-events-auto inline-flex flex-wrap border border-[#2c3338] rounded-md overflow-hidden bg-[#1b2024]/95">
              {(
                [
                  ['now', 'Current aerial'],
                  ['swipe', 'Swipe compare'],
                  ['pre', 'Pre-disaster'],
                  ['gis', 'GIS map'],
                  ['gmap', 'Google Maps'],
                  ['3d', '3D area'],
                ] as [AreaMode, string][]
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setAmode(m);
                    if (m === 'swipe' && vb) setSwipeX(vb[0] + vb[2] / 2);
                  }}
                  className={`min-h-[38px] px-2.5 md:px-3 py-1.5 text-xs font-medium border-r last:border-r-0 border-[#2c3338] cursor-pointer whitespace-nowrap ${
                    amode === m
                      ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                      : 'text-[#e7eaec] hover:bg-[#232a2f]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="pointer-events-auto hidden sm:block">
              <SimulatedBadge />
            </div>
          </div>

          {/* 2D SVG Map */}
          <svg
            ref={svgRef}
            aria-label="Area map"
            className={`w-full h-full touch-none select-none ${
              amode === '3d' || amode === 'gmap' ? 'hidden' : 'block'
            }`}
            onWheel={(e) => {
              e.preventDefault();
              const svg = svgRef.current;
              if (!svg || amode === '3d' || amode === 'gmap') return;
              const cur =
                vb || fitVB(svg, [ev.fb.x0 - 40, ev.fb.y0 - 40, ev.fb.x1 + 40, ev.fb.y1 + 40]);
              const p = svgPt(svg, e.clientX, e.clientY);
              const f = Math.exp(e.deltaY * 0.0012);
              const w = clamp(cur[2] * f, 120, 2400);
              const r = w / cur[2];
              setVb([p.x - (p.x - cur[0]) * r, p.y - (p.y - cur[1]) * r, w, cur[3] * r]);
            }}
            onPointerDown={(e) => {
              if (e.button !== 0 || amode === '3d') return;
              const svg = svgRef.current;
              if (!svg) return;
              const cur =
                vb || fitVB(svg, [ev.fb.x0 - 40, ev.fb.y0 - 40, ev.fb.x1 + 40, ev.fb.y1 + 40]);
              const pt = svgPt(svg, e.clientX, e.clientY);
              const swiping =
                amode === 'swipe' && Math.abs(pt.x - swipeX) < (cur[2] / (svg.clientWidth || 800)) * 20;
              dragRef.current = { x: e.clientX, y: e.clientY, vb: cur, moved: false, swiping };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const svg = svgRef.current;
              if (!svg || amode === '3d') return;
              const pt = svgPt(svg, e.clientX, e.clientY);
              const b = bAt(ev.city, pt) || null;
              setHoverB(b);
              setHoverPos(b ? { x: e.clientX, y: e.clientY } : null);

              if (!dragRef.current) return;
              const dx = e.clientX - dragRef.current.x;
              const dy = e.clientY - dragRef.current.y;
              if (Math.abs(dx) + Math.abs(dy) > 4) dragRef.current.moved = true;
              if (!dragRef.current.moved) return;

              if (dragRef.current.swiping) {
                setSwipeX(pt.x);
              } else {
                const s = dragRef.current.vb[2] / (svg.clientWidth || 800);
                setVb([
                  dragRef.current.vb[0] - dx * s,
                  dragRef.current.vb[1] - dy * s,
                  dragRef.current.vb[2],
                  dragRef.current.vb[3],
                ]);
              }
            }}
            onPointerUp={(e) => {
              const svg = svgRef.current;
              if (dragRef.current && !dragRef.current.moved && svg) {
                const pt = svgPt(svg, e.clientX, e.clientY);
                const b = bAt(ev.city, pt);
                if (!b) {
                  setAddPopup(null);
                } else if (ev.H[b.id]) {
                  setAddPopup(null);
                  onOpenBuilding(b.id);
                } else if (mapBoxRef.current) {
                  const r = mapBoxRef.current.getBoundingClientRect();
                  setAddPopup({
                    b,
                    x: clamp(e.clientX - r.left + 10, 10, Math.max(10, r.width - 255)),
                    y: clamp(e.clientY - r.top + 10, 56, Math.max(56, r.height - 175)),
                    sev: 'n',
                  });
                }
              }
              dragRef.current = null;
            }}
            onPointerLeave={() => {
              setHoverB(null);
              setHoverPos(null);
            }}
          />

          {/* Live Google Maps Area View */}
          {amode === 'gmap' && (
            <div className="w-full h-full">
              <GoogleAreaMap
                ev={ev}
                t={t}
                layers={layers}
                onOpenBuilding={onOpenBuilding}
              />
            </div>
          )}

          {/* 3D Area Canvas */}
          {amode === '3d' && (
            <div className="w-full h-full">
              <Canvas3DView
                draw={(ctx, w, h, cam) => draw3DA(ctx, w, h, cam, ev, t)}
                deps={[ev, t, ev.priorityOrder, ev.hits.length]}
              />
            </div>
          )}

          {/* Status Overlay */}
          {amode !== 'gmap' && (
            <div className="absolute right-2.5 top-14 z-10 bg-[#0a0c0e]/90 border border-[#2c3338] rounded-md px-3 py-2 text-xs text-[#e7eaec] max-w-[300px] pointer-events-none">
              {amode === 'swipe' && (
                <div className="font-semibold text-[#45c4ea] mb-0.5">
                  Swipe: left pre-disaster, right current. Drag handle.
                </div>
              )}
              <div>{statusBanner}</div>
            </div>
          )}

          {/* Layer Panel (collapsible on mobile and gmap mode; always accessible) */}
          {amode !== '3d' && (
            <div
              className={`absolute z-10 ${
                amode === 'gmap' ? 'right-2.5 top-14 flex flex-col items-end' : 'left-2.5 bottom-2.5'
              }`}
            >
              <button
                type="button"
                onClick={() => setLayersOpen((o) => !o)}
                className={`${
                  amode === 'gmap' ? 'flex min-h-[34px] px-2.5 py-1' : 'lg:hidden min-h-[40px] px-3 py-2 flex'
                } rounded-md bg-[#0a0c0e]/95 border border-[#2c3338] hover:border-[#45c4ea] text-xs font-medium text-[#e7eaec] items-center gap-1.5 cursor-pointer shadow`}
              >
                <Layers className="w-3.5 h-3.5 text-[#45c4ea]" />
                Layers
              </button>

              <div
                className={`${
                  amode === 'gmap'
                    ? layersOpen
                      ? 'grid mt-1.5 shadow-2xl'
                      : 'hidden'
                    : layersOpen
                      ? 'grid mt-1.5 lg:mt-0'
                      : 'hidden lg:grid mt-1.5 lg:mt-0'
                } bg-[#0a0c0e]/95 border border-[#2c3338] rounded-lg p-3 gap-1 text-xs`}
              >
                {LAYER_DEFS.map(([k, label, col]) => (
                  <label
                    key={k}
                    className="flex items-center gap-2 cursor-pointer min-h-[26px] text-[#e7eaec] select-none"
                  >
                    <input
                      type="checkbox"
                      checked={layers[k]}
                      onChange={(e) => setLayers((prev) => ({ ...prev, [k]: e.target.checked }))}
                      className="accent-[#45c4ea] w-3.5 h-3.5"
                    />
                    <span
                      className="w-3.5 h-1 rounded-sm inline-block shrink-0"
                      style={{ backgroundColor: col }}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Zoom Controls */}
          {amode !== '3d' && amode !== 'gmap' && (
            <div className="absolute right-2.5 bottom-2.5 z-10 flex flex-col gap-1">
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => zoomMap(1.4)}
                className="w-10 h-10 flex items-center justify-center rounded-md bg-[#1b2024]/95 border border-[#2c3338] text-[#e7eaec] hover:border-[#45c4ea] cursor-pointer"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => zoomMap(0.7)}
                className="w-10 h-10 flex items-center justify-center rounded-md bg-[#1b2024]/95 border border-[#2c3338] text-[#e7eaec] hover:border-[#45c4ea] cursor-pointer"
              >
                <Minus className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="Fit area"
                onClick={() => zoomMap(0)}
                className="w-10 h-10 flex items-center justify-center rounded-md bg-[#1b2024]/95 border border-[#2c3338] text-xs font-medium text-[#e7eaec] hover:border-[#45c4ea] cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Hover Tooltip (desktop) */}
          {hoverB && hoverPos && amode !== '3d' && amode !== 'gmap' && !addPopup && (
            <div
              className="hidden md:block fixed z-30 pointer-events-none bg-[#0a0c0e]/95 border border-[#2c3338] rounded-md px-3 py-2 text-xs max-w-[260px]"
              style={{ left: hoverPos.x + 14, top: hoverPos.y + 14 }}
            >
              <div className="font-semibold text-[#e7eaec]">{hoverB.addr}</div>
              <div className="text-[#929ba2] mt-0.5">
                {hoverB.floors} floors · {hoverB.units} flats
              </div>
              {ev.H[hoverB.id] ? (
                (() => {
                  const h = ev.H[hoverB.id];
                  const rk = getBuildingRank(ev, hoverB.id);
                  return (
                    <div className="mt-1 space-y-0.5 text-[#e7eaec]">
                      <div>
                        {SEV[h.sev].n} · {rk != null ? `Priority #${rk}` : 'Not ranked'}
                      </div>
                      <div className="text-[#ff9ad1]">
                        {h.dev.filter((d) => loc3(d, t)).length} phones 3D ·{' '}
                        {h.dev.filter((d) => t >= d.t2).length} detected
                      </div>
                      <div className="text-[#45c4ea]">
                        {msgsAt(ev, t, h.id).length} reports · click to open file
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="text-[#929ba2] mt-1">Not in event · click to add building</div>
              )}
            </div>
          )}

          {/* Add Building Popover */}
          {addPopup && (
            <div
              className="absolute z-20 bg-[#1b2024] border border-[#2c3338] rounded-lg p-3 w-[245px] shadow-2xl flex flex-col gap-2"
              style={{ left: addPopup.x, top: addPopup.y }}
            >
              <div>
                <div className="font-semibold text-sm text-[#e7eaec]">{addPopup.b.addr}</div>
                <div className="text-xs text-[#929ba2]">
                  {addPopup.b.floors} floors · {addPopup.b.units} flats · not in the event
                </div>
              </div>
              <label className="text-xs text-[#929ba2] flex flex-col gap-1">
                Initial severity
                <select
                  value={addPopup.sev}
                  onChange={(e) =>
                    setAddPopup((p) => (p ? { ...p, sev: e.target.value as SeverityKey } : p))
                  }
                  className="min-h-[36px] bg-[#15191c] border border-[#2c3338] rounded px-2 text-xs text-[#e7eaec]"
                >
                  {(Object.keys(SEV) as SeverityKey[]).map((k) => (
                    <option key={k} value={k}>
                      {SEV[k].n}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  const id = addPopup.b.id;
                  const sev = addPopup.sev;
                  setAddPopup(null);
                  onAddBuilding(id, sev);
                }}
                className="min-h-[38px] rounded-md bg-[#ff6a2b] text-[#160800] font-semibold text-xs cursor-pointer"
              >
                Add to event (opens file)
              </button>
              <button
                type="button"
                onClick={() => setAddPopup(null)}
                className="min-h-[34px] rounded-md bg-[#232a2f] border border-[#2c3338] text-xs text-[#e7eaec] cursor-pointer"
              >
                Close
              </button>
            </div>
          )}
        </div>

        {/* Right: Side Console Tabs */}
        <aside
          className={`bg-[#15191c] lg:border-l border-[#2c3338] flex flex-col min-h-0 ${
            mobilePane === 'map' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="flex flex-wrap gap-1 p-2 border-b border-[#2c3338] shrink-0">
            {TABS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`min-h-[36px] px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors whitespace-nowrap ${
                  tab === k
                    ? 'bg-[#232a2f] text-white'
                    : 'text-[#929ba2] hover:text-[#e7eaec]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
            {/* TAB: PRIORITY (Commander Ordered, NO Computed Score) */}
            {tab === 'prio' && (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-[#929ba2] m-0">
                    Commander sets rescue priority order and notes. Unranked buildings appear below
                    as &ldquo;Not ranked&rdquo;.
                  </p>
                  {rankedList.length > 0 && (
                    <button
                      type="button"
                      onClick={onClearRanks}
                      className="text-xs text-[#929ba2] hover:text-white underline whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Clear order
                    </button>
                  )}
                </div>

                {/* Ranked Buildings */}
                {rankedList.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-[#e7eaec]">
                      Commander priority order ({rankedList.length})
                    </div>
                    {rankedList.map((h, i) => {
                      const b = ev.city.bl[h.id];
                      const l = h.dev.filter((d) => loc3(d, t)).length;
                      const dd = h.dev.filter((d) => t >= d.t2).length;
                      const rep = msgsAt(ev, t, h.id).length;
                      const reason = ev.priorityReasons[h.id] ?? '';

                      return (
                        <div
                          key={h.id}
                          className="bg-[#1b2024] border border-[#2c3338] rounded-lg p-2.5 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0">
                              <span className="font-cond font-bold text-base text-[#ff6a2b] tabular-nums shrink-0 mt-0.5">
                                #{i + 1}
                              </span>
                              <div className="min-w-0">
                                <button
                                  type="button"
                                  onClick={() => onOpenBuilding(h.id)}
                                  className="font-semibold text-sm text-[#e7eaec] hover:text-[#45c4ea] text-left cursor-pointer"
                                >
                                  {b.addr}
                                </button>
                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                  <SeverityChip sev={h.sev} />
                                  <span className="text-xs text-[#929ba2] tabular-nums">
                                    {l}
                                    {dd > l ? `+${dd - l}` : ''} phones · {rep} reports
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                aria-label={`Move ${b.addr} up`}
                                disabled={i === 0}
                                onClick={() => onMoveRank(h.id, -1)}
                                className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded bg-[#232a2f] border border-[#2c3338] disabled:opacity-30 cursor-pointer"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Move ${b.addr} down`}
                                disabled={i === rankedList.length - 1}
                                onClick={() => onMoveRank(h.id, 1)}
                                className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded bg-[#232a2f] border border-[#2c3338] disabled:opacity-30 cursor-pointer"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onUnrankBuilding(h.id)}
                                className="min-h-[32px] px-2 rounded bg-[#232a2f] border border-[#2c3338] text-xs text-[#929ba2] hover:text-white cursor-pointer"
                              >
                                Unrank
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
                            <input
                              type="text"
                              value={reason}
                              onChange={(e) => onSetRankReason(h.id, e.target.value)}
                              placeholder="Commander reason (optional)…"
                              aria-label={`Priority reason for ${b.addr}`}
                              className="min-h-[34px] bg-[#15191c] border border-[#2c3338] rounded px-2.5 py-1 text-xs text-[#e7eaec] placeholder:text-[#929ba2]/60"
                            />
                            <select
                              aria-label={`Assign team to ${b.addr}`}
                              value={ev.team[h.id] || 'Unassigned'}
                              onChange={(e) =>
                                onAssignTeam(
                                  h.id,
                                  e.target.value === 'Unassigned' ? null : e.target.value
                                )
                              }
                              className="min-h-[34px] bg-[#15191c] border border-[#2c3338] rounded px-2 py-1 text-xs text-[#e7eaec] max-w-[130px]"
                            >
                              {SRC_IL.teams.map((tm) => (
                                <option key={tm} value={tm}>
                                  {tm}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Unranked Buildings */}
                {unrankedList.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-[#2c3338]">
                    <div className="text-xs font-medium text-[#929ba2]">
                      Not ranked ({unrankedList.length})
                    </div>
                    {unrankedList.map((h) => {
                      const b = ev.city.bl[h.id];
                      const l = h.dev.filter((d) => loc3(d, t)).length;
                      const dd = h.dev.filter((d) => t >= d.t2).length;
                      const rep = msgsAt(ev, t, h.id).length;

                      return (
                        <div
                          key={h.id}
                          className="bg-[#1b2024]/70 border border-[#2c3338] rounded-md px-2.5 py-2 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => onOpenBuilding(h.id)}
                              className="font-medium text-sm text-[#e7eaec] hover:text-[#45c4ea] text-left truncate block cursor-pointer"
                            >
                              {b.addr}
                            </button>
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-xs text-[#929ba2]">
                              <SeverityChip sev={h.sev} />
                              <span>Not ranked</span>
                              <span>·</span>
                              <span className="tabular-nums">
                                {l}
                                {dd > l ? `+${dd - l}` : ''} ph · {rep} rep
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <select
                              aria-label={`Assign team to ${b.addr}`}
                              value={ev.team[h.id] || 'Unassigned'}
                              onChange={(e) =>
                                onAssignTeam(
                                  h.id,
                                  e.target.value === 'Unassigned' ? null : e.target.value
                                )
                              }
                              className="min-h-[34px] bg-[#15191c] border border-[#2c3338] rounded px-1.5 py-1 text-xs text-[#e7eaec] max-w-[105px]"
                            >
                              {SRC_IL.teams.map((tm) => (
                                <option key={tm} value={tm}>
                                  {tm}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => onRankBuilding(h.id)}
                              className="min-h-[34px] px-2.5 rounded bg-[#232a2f] border border-[#2c3338] hover:border-[#45c4ea] text-xs font-medium text-[#e7eaec] cursor-pointer whitespace-nowrap"
                            >
                              Rank
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB: PHONES (Phase 2 · Simulated) */}
            {tab === 'phones' &&
              (() => {
                const rows = ev.hits.flatMap((h) =>
                  h.dev.filter((d) => t >= d.t2).map((d) => ({ h, d }))
                );
                const resp = t > 20 ? Math.min(46, Math.floor((t - 20) / 4)) : 0;
                return (
                  <div className="space-y-2.5">
                    <div className="bg-[#2a1222] border border-[#5a2347] rounded-md p-2.5 text-xs text-[#ffc4e3] flex items-start justify-between gap-2">
                      <span>
                        Phase 2 layer: active cellular locator on drone. Pending spectrum licence.
                        Data here is simulated.
                      </span>
                      <SimulatedBadge phase2 />
                    </div>
                    <p className="text-xs text-[#929ba2] m-0 tabular-nums">
                      {rows.length} phones detected · {rows.filter((r) => loc3(r.d, t)).length}{' '}
                      located in 3D · {resp} rescue-team phones filtered out
                    </p>
                    <button
                      type="button"
                      onClick={onSendSmsAll}
                      className="min-h-[38px] px-3 py-1.5 rounded-md bg-[#232a2f] border border-[#2c3338] hover:border-[#ff3fa4] text-xs font-medium text-[#e7eaec] cursor-pointer"
                    >
                      Send SMS to all located phones
                    </button>

                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr className="text-left text-[#929ba2] border-b border-[#2c3338]">
                            <th className="py-1.5 pr-2 font-medium">Phone</th>
                            <th className="py-1.5 pr-2 font-medium">Building</th>
                            <th className="py-1.5 pr-2 font-medium">Fix</th>
                            <th className="py-1.5 font-medium">SMS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(({ h, d }) => {
                            const b = ev.city.bl[h.id];
                            const l = loc3(d, t);
                            const key = `${h.id}-${d.k}`;
                            const smsSent = ev.sms[key];

                            return (
                              <tr
                                key={key}
                                className="border-b border-[#22292e] hover:bg-[#1b2024]"
                              >
                                <td className="py-2 pr-2">
                                  <span className="font-semibold text-[#e7eaec]">P{d.k + 1}</span>{' '}
                                  <span className="text-[#929ba2] font-mono-tab">
                                    {d.imsi.slice(-4)}
                                  </span>
                                  <div className="text-[#929ba2]">{d.carrier}</div>
                                </td>
                                <td className="py-2 pr-2">
                                  <button
                                    type="button"
                                    onClick={() => onOpenBuilding(h.id)}
                                    className="text-left text-[#45c4ea] hover:underline cursor-pointer"
                                  >
                                    {b.addr}
                                  </button>
                                </td>
                                <td className="py-2 pr-2 tabular-nums">
                                  {l ? (
                                    <>
                                      <div>3D ±{d.acc.toFixed(1)} m</div>
                                      <div className="text-[#929ba2]">floor {fl(d.floor)}</div>
                                    </>
                                  ) : (
                                    <div>2D ±20 m</div>
                                  )}
                                  {!alive(d, t) && (
                                    <div className="text-[#929ba2]">signal lost</div>
                                  )}
                                </td>
                                <td className="py-2">
                                  {!l && !alive(d, t) ? (
                                    <span className="text-[#929ba2]">—</span>
                                  ) : smsSent == null ? (
                                    <button
                                      type="button"
                                      onClick={() => onSendSms(h.id, d.k)}
                                      className="min-h-[32px] px-2.5 py-1 rounded bg-[#232a2f] border border-[#2c3338] hover:border-[#ff3fa4] text-xs cursor-pointer whitespace-nowrap"
                                    >
                                      Send SMS
                                    </button>
                                  ) : !alive(d, smsSent + 0.5) ? (
                                    <span className="text-[#929ba2]">Not delivered</span>
                                  ) : d.reply && t >= smsSent + d.rd ? (
                                    <span className="text-[#ffc4e3]">
                                      &ldquo;{d.reply.replace('{F}', fl(d.floor))}&rdquo;
                                    </span>
                                  ) : t >= smsSent + 0.5 ? (
                                    <span className="text-[#929ba2]">Delivered · waiting</span>
                                  ) : (
                                    <span className="text-[#929ba2]">Sending…</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

            {/* TAB: REPORTS */}
            {tab === 'rep' &&
              (() => {
                const list = msgsAt(ev, t).filter((m) => {
                  const st = m.sms ? 'supported' : msgStatus(ev, m, t)[0];
                  return repFilter === 'all' || repFilter === st;
                });

                return (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[#929ba2]">OSINT & emergency hotlines</span>
                      <SimulatedBadge />
                    </div>
                    <div className="flex flex-wrap border border-[#2c3338] rounded-md overflow-hidden bg-[#1b2024]">
                      {(
                        ['all', 'reported', 'supported', 'verified', 'flagged'] as ReportFilter[]
                      ).map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setRepFilter(k)}
                          className={`min-h-[34px] px-2.5 py-1 text-xs border-r last:border-r-0 border-[#2c3338] capitalize cursor-pointer ${
                            repFilter === k
                              ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                              : 'text-[#929ba2] hover:text-white'
                          }`}
                        >
                          {k}
                        </button>
                      ))}
                    </div>

                    {list.length === 0 ? (
                      <p className="text-xs text-[#929ba2]">No reports in this filter yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {list.map((m) => (
                          <MessageCard
                            key={m.id}
                            ev={ev}
                            m={m}
                            t={t}
                            showBuilding
                            onOpenBuilding={onOpenBuilding}
                            onVerify={onVerifyMsg}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

            {/* TAB: RESIDENTS (Names hidden · Simulated) */}
            {tab === 'res' &&
              (() => {
                const tot = { reg: 0, loc: 0, miss: 0, unk: 0 };
                const rows = ev.hits.map((h) => {
                  const s = resSum(h, t);
                  if (t >= h.resT) {
                    tot.reg += s.reg;
                    tot.loc += s.loc;
                    tot.miss += s.miss;
                    tot.unk += s.unk;
                  }
                  return { h, s };
                });

                return (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[#929ba2]">
                        Source: {SRC_IL.res}. Names hidden.
                      </span>
                      <SimulatedBadge />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr className="text-left text-[#929ba2] border-b border-[#2c3338]">
                            <th className="py-1.5 pr-2 font-medium">Building</th>
                            <th className="py-1.5 pr-2 text-right font-medium">Reg.</th>
                            <th className="py-1.5 pr-2 text-right font-medium">Located</th>
                            <th className="py-1.5 pr-2 text-right font-medium">Missing</th>
                            <th className="py-1.5 text-right font-medium">Unknown</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(({ h, s }) => (
                            <tr
                              key={h.id}
                              onClick={() => onOpenBuilding(h.id)}
                              className="border-b border-[#22292e] hover:bg-[#1b2024] cursor-pointer"
                            >
                              <td className="py-2 pr-2 text-[#e7eaec]">
                                {ev.city.bl[h.id].addr}
                              </td>
                              {t < h.resT ? (
                                <td colSpan={4} className="py-2 text-right text-[#929ba2]">
                                  Register requested
                                </td>
                              ) : (
                                <>
                                  <td className="py-2 pr-2 text-right tabular-nums">{s.reg}</td>
                                  <td className="py-2 pr-2 text-right tabular-nums">{s.loc}</td>
                                  <td className="py-2 pr-2 text-right tabular-nums font-semibold text-[#ff9a8a]">
                                    {s.miss}
                                  </td>
                                  <td className="py-2 text-right tabular-nums">{s.unk}</td>
                                </>
                              )}
                            </tr>
                          ))}
                          <tr className="font-semibold text-[#e7eaec]">
                            <td className="py-2 pr-2">Total</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{tot.reg}</td>
                            <td className="py-2 pr-2 text-right tabular-nums">{tot.loc}</td>
                            <td className="py-2 pr-2 text-right tabular-nums text-[#ff9a8a]">
                              {tot.miss}
                            </td>
                            <td className="py-2 text-right tabular-nums">{tot.unk}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

            {/* TAB: BUILDINGS INVENTORY */}
            {tab === 'inv' && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-[#929ba2]">
                    Street-level pre-event view & construction
                  </span>
                  <SimulatedBadge />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-2.5">
                  {ordered.map((h) => {
                    const b = ev.city.bl[h.id];
                    const svReady = t >= (h.l4m || h.l4g);
                    return (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => onOpenBuilding(h.id)}
                        className="text-left bg-[#1b2024] border border-[#2c3338] hover:border-[#4b565e] rounded-lg overflow-hidden cursor-pointer"
                      >
                        <div className="aspect-[400/240] bg-[#15191c]">
                          {svReady ? (
                            <svg
                              viewBox="0 0 400 240"
                              className="w-full h-full block"
                              dangerouslySetInnerHTML={{ __html: facadeSVG(b) }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs text-[#929ba2]">
                              Loading street view…
                            </div>
                          )}
                        </div>
                        <div className="p-2.5 space-y-1 text-xs">
                          <div className="flex items-center justify-between gap-1.5">
                            <b className="text-[#e7eaec] truncate">{b.addr}</b>
                            <SeverityChip sev={h.sev} />
                          </div>
                          <div className="text-[#929ba2]">
                            {b.floors}F · {b.units} flats · {b.year}
                          </div>
                          <div className="text-[#929ba2] truncate">{b.shelter}</div>
                          <div className="text-[#929ba2]">
                            Plans: {t < h.bpT ? 'requested' : h.bpA ? 'received' : 'inferred'} · 3D:{' '}
                            {h.mr != null && t >= h.mr
                              ? 'ready'
                              : h.os != null && t >= h.os
                                ? 'in progress'
                                : 'queued'}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB: ASSETS */}
            {tab === 'assets' &&
              (() => {
                const f = ev.fb;
                const dp = dronePos(ev, t);
                const taskLabel = (id: string) => {
                  const d = ev.drones.find((x) => x.id === id);
                  if (!d) return 'Idle';
                  const cur = d.tasks.find((k) => t >= k.s && t < k.e);
                  if (cur) return `Orbiting ${ev.city.bl[cur.b].addr} for the 3D model`;
                  const nx = d.tasks.filter((k) => k.s > t).length;
                  return nx ? `Idle · ${nx} orbit(s) queued` : 'Idle';
                };
                const m1Status =
                  t < f.T0
                    ? 'On vehicle · preflight checks'
                    : t < f.T1
                      ? `Mapping flight · strip ${Math.min(
                          f.n,
                          Math.floor(((t - f.T0) / (f.T1 - f.T0)) * f.n) + 1
                        )} of ${f.n} · battery ${Math.round(100 - (t - f.T0) * 2.8)}%`
                      : t < 50
                        ? 'Landed · battery swap'
                        : taskLabel('M-1');

                const jobs: [string, number][] = [];
                if (t >= f.T1 && t < 68) {
                  jobs.push(['Orthophoto v1 (OpenDroneMap)', (t - f.T1) / (68 - f.T1)]);
                }
                for (const h of ev.hits) {
                  if (h.oe != null && h.mr != null && t >= h.oe && t < h.mr) {
                    jobs.push([
                      `3D splat · ${ev.city.bl[h.id].addr}`,
                      (t - h.oe) / (h.mr - h.oe),
                    ]);
                  }
                }
                const uploads = ev.hits
                  .filter((h) => h.mr != null && t >= h.mr && t < h.mr + 9)
                  .map((h) => [
                    `Upload PLY 280 MB · ${ev.city.bl[h.id].addr}`,
                    (t - (h.mr || 0)) / 9,
                  ]) as [string, number][];

                return (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[#929ba2]">Field kit & aerial assets</span>
                      <SimulatedBadge />
                    </div>
                    <div className="bg-[#1b2024] border border-[#2c3338] rounded-lg p-3 space-y-1">
                      <b className="font-cond text-sm text-[#e7eaec]">M-1 · mapping drone</b>
                      <div className="text-xs text-[#929ba2]">{m1Status}</div>
                    </div>
                    <div className="bg-[#1b2024] border border-[#2c3338] rounded-lg p-3 space-y-1">
                      <b className="font-cond text-sm text-[#e7eaec]">O-1 · 3D orbit drone</b>
                      <div className="text-xs text-[#929ba2]">
                        {t < 42 ? `Preflight · first orbit at ${fT(42)}` : taskLabel('O-1')}
                      </div>
                    </div>
                    <div className="bg-[#1b2024] border border-[#2c3338] rounded-lg p-3 space-y-1">
                      <b className="font-cond text-sm text-[#e7eaec]">
                        T-3 · team drone (DJI M30T)
                      </b>
                      <div className="text-xs text-[#929ba2]">
                        {t < 110
                          ? `Joins at ${fT(110)}`
                          : dp.some((d) => d.id === 'T-3')
                            ? 'Refresh flight over the whole area'
                            : `Standby · next refresh at ${fT([120, 180, 240, 300].find((x) => x > t) || 300)}`}
                      </div>
                    </div>
                    <div className="bg-[#1b2024] border border-[#2c3338] rounded-lg p-3 space-y-1">
                      <b className="font-cond text-sm text-[#e7eaec]">Starlink</b>
                      <div className="text-xs text-[#929ba2]">
                        {t < 25
                          ? `Not connected · field kit works offline · connects at ${fT(25)}`
                          : 'Connected · ≈18 Mbps up · event synced to the cloud'}
                      </div>
                    </div>
                    <div className="bg-[#1b2024] border border-[#2c3338] rounded-lg p-3 space-y-2">
                      <b className="font-cond text-sm text-[#e7eaec]">Field GPU · processing</b>
                      {jobs.length ? (
                        jobs.map(([label, pct]) => (
                          <div key={label} className="space-y-1">
                            <div className="text-xs text-[#e7eaec]">{label}</div>
                            <div className="h-1.5 bg-[#232a2f] rounded overflow-hidden">
                              <div
                                className="h-full bg-[#45c4ea]"
                                style={{ width: `${Math.round(pct * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-[#929ba2]">No jobs running</div>
                      )}
                    </div>
                    <div className="bg-[#1b2024] border border-[#2c3338] rounded-lg p-3 space-y-2">
                      <b className="font-cond text-sm text-[#e7eaec]">Uploads to cloud</b>
                      {uploads.length ? (
                        uploads.map(([label, pct]) => (
                          <div key={label} className="space-y-1">
                            <div className="text-xs text-[#e7eaec]">{label}</div>
                            <div className="h-1.5 bg-[#232a2f] rounded overflow-hidden">
                              <div
                                className="h-full bg-[#45c4ea]"
                                style={{ width: `${Math.round(pct * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-[#929ba2]">Queue empty</div>
                      )}
                    </div>
                    <div className="bg-[#1b2024] border border-[#2c3338] rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <b className="font-cond text-sm text-[#e7eaec]">
                          Google Drive files (Google Picker)
                        </b>
                        <StatusChip tone="ok">{driveFiles.length} linked</StatusChip>
                      </div>
                      <div className="text-xs text-[#929ba2]">
                        Attach real plans, spreadsheets, or field briefs from Google Drive.
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {driveNeedsAuth ? (
                          <GoogleSignInButton
                            compact
                            onClick={onGoogleSignIn}
                            loading={driveSigningIn}
                          />
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={drivePicking}
                              onClick={() => onOpenPicker(null)}
                              className="min-h-[32px] px-2.5 py-1 rounded bg-[#232a2f] border border-[#45c4ea]/70 hover:border-[#45c4ea] text-xs font-medium text-[#e7eaec] cursor-pointer disabled:opacity-50"
                            >
                              {drivePicking ? 'Opening Picker…' : 'Open Google Picker'}
                            </button>
                            <button
                              type="button"
                              onClick={onOpenDriveDrawer}
                              className="min-h-[32px] px-2.5 py-1 rounded bg-[#15191c] border border-[#2c3338] text-xs text-[#929ba2] hover:text-white cursor-pointer"
                            >
                              View files ({driveFiles.length})
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="bg-[#1b2024] border border-[#2c3338] rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <b className="font-cond text-sm text-[#e7eaec]">
                          Command briefings (Google Meet)
                        </b>
                        <StatusChip tone="ok">{meetSpaces.length} rooms</StatusChip>
                      </div>
                      <div className="text-xs text-[#929ba2]">
                        Launch team briefing rooms and inspect conference status.
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {driveNeedsAuth ? (
                          <GoogleSignInButton
                            compact
                            onClick={onGoogleSignIn}
                            loading={driveSigningIn}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={onOpenMeetDrawer}
                            className="min-h-[32px] px-2.5 py-1 rounded bg-[#232a2f] border border-[#45c4ea]/70 hover:border-[#45c4ea] text-xs font-medium text-[#e7eaec] cursor-pointer"
                          >
                            {meetSpaces.length > 0 ? `Manage Meet (${meetSpaces.length})` : 'Create Google Meet'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

            {/* TAB: LOG */}
            {tab === 'log' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-[#929ba2]">Timeline events up to {fT(t)}</span>
                  <SimulatedBadge />
                </div>
                <div className="divide-y divide-[#22292e]">
                  {logAt(ev, t)
                    .slice(0, 80)
                    .map((l, idx) => (
                      <div key={idx} className="grid grid-cols-[62px_minmax(0,1fr)] gap-2 py-1.5 text-xs">
                        <span className="font-mono-tab text-[#929ba2]">{fT(l.t)}</span>
                        <span className="text-[#e7eaec]">{l.txt}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function MessageCard({
  ev,
  m,
  t,
  showBuilding,
  onOpenBuilding,
  onVerify,
}: {
  ev: EventState;
  m: OsintMessage;
  t: number;
  showBuilding: boolean;
  onOpenBuilding?: (id: number) => void;
  onVerify: (id: number | string) => void;
}) {
  const [status, why] = m.sms ? (['supported', 'Direct from a located phone'] as const) : msgStatus(ev, m, t);
  const b = ev.city.bl[m.b];

  const borderCls =
    status === 'verified'
      ? 'border-[#45c4ea]/60'
      : status === 'supported'
        ? 'border-[#ff6a2b]/60'
        : status === 'flagged'
          ? 'border-[#c0392b]/60 opacity-85'
          : 'border-[#2c3338]';

  const tone =
    status === 'verified'
      ? 'ok'
      : status === 'flagged'
        ? 'crit'
        : status === 'supported'
          ? 'warn'
          : 'neutral';

  return (
    <div className={`bg-[#1b2024] border ${borderCls} rounded-lg p-3 space-y-2 text-xs`}>
      <div className="flex flex-wrap items-center gap-2 text-[#929ba2]">
        <b className="text-[#e7eaec]">{m.ch}</b>
        <span className="font-mono-tab">{fT(m.t)}</span>
        {showBuilding && b && onOpenBuilding && (
          <button
            type="button"
            onClick={() => onOpenBuilding(m.b)}
            className="text-[#45c4ea] hover:underline cursor-pointer"
          >
            {b.addr}
          </button>
        )}
        {m.lang && m.lang !== 'en' && (
          <span>translated from {m.lang === 'he' ? 'Hebrew' : 'Arabic'}</span>
        )}
      </div>

      <div className="text-[#e7eaec] text-sm leading-snug">{m.txt}</div>

      <div className="flex flex-wrap items-center gap-2 text-[#929ba2]">
        <StatusChip tone={tone}>{why}</StatusChip>
        <span>
          extracted: floor {fl(m.floor)}
          {m.apt ? ` · apt ${m.apt}` : ''}
        </span>
        <span>{m.srcs > 1 ? '2 independent sources' : '1 source'}</span>
      </div>

      {!m.sms && !m.fake && status !== 'verified' && (
        <button
          type="button"
          onClick={() => onVerify(m.id)}
          className="min-h-[34px] px-3 py-1 rounded bg-[#232a2f] border border-[#2c3338] hover:border-[#45c4ea] text-xs font-medium text-[#e7eaec] cursor-pointer"
        >
          Mark field-verified
        </button>
      )}
    </div>
  );
}
