import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { EventState, SeverityKey } from '../types/sara';
import {
  SEV,
  SRC_IL,
  alive,
  clamp,
  cmodel,
  fT,
  fl,
  getBuildingRank,
  lays,
  loc3,
  msgsAt,
  orderedHits,
  orthoV,
  pl,
  resStat,
  resSum,
} from '../sim/engine';
import {
  applyWorldLayers,
  draw3DB,
  dynSVG,
  facadeSVG,
  planSVG,
  svgPt,
  worldSVG,
} from '../sim/renderers';
import { Canvas3DView } from './Canvas3DView';
import { LayerStatusChip, SimulatedBadge, StatusChip } from './StatusChip';
import { MessageCard } from './AreaView';

interface BuildingViewProps {
  ev: EventState;
  bid: number;
  t: number;
  onBackToArea: () => void;
  onOpenBuilding: (id: number) => void;
  onChangeSeverity: (id: number, sev: SeverityKey) => void;
  onAssignTeam: (id: number, team: string | null) => void;
  onSendSms: (buildingId: number, devIndex: number) => void;
  onVerifyMsg: (msgId: number | string) => void;
  onRankBuilding: (id: number) => void;
  onUnrankBuilding: (id: number) => void;
  onSetRankReason: (id: number, reason: string) => void;
}

export function BuildingView({
  ev,
  bid,
  t,
  onBackToArea,
  onOpenBuilding,
  onChangeSeverity,
  onAssignTeam,
  onSendSms,
  onVerifyMsg,
  onRankBuilding,
  onUnrankBuilding,
  onSetRankReason,
}: BuildingViewProps) {
  const b = ev.city.bl[bid];
  const h = ev.H[bid];

  const [bnowMode, setBnowMode] = useState<'now' | 'swipe'>('now');
  const [swipeX, setSwipeX] = useState<number>(b ? b.cx : 600);
  const [xrayPhones, setXrayPhones] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [selectedFloor, setSelectedFloor] = useState<number>(1);
  const [svSource, setSvSource] = useState<'m' | 'g'>('m');
  const [editingReason, setEditingReason] = useState(false);

  const nowSvgRef = useRef<SVGSVGElement | null>(null);
  const preSvgRef = useRef<SVGSVGElement | null>(null);
  const mapSvgRef = useRef<SVGSVGElement | null>(null);
  const draggingSwipeRef = useRef(false);

  useEffect(() => {
    if (!b || !h) return;
    setSwipeX(b.cx);
    setSelectedFloor(Math.min(b.floors - 1, h.dev.length ? h.dev[0].floor : 1));
    setSvSource(h.l4m ? 'm' : 'g');
    setEditingReason(false);
  }, [bid, b?.id]);

  // Initialize static SVG layers for Current Aerial, Pre-disaster, and Location
  useEffect(() => {
    if (!b || !h) return;
    const bb: [number, number, number, number] = [b.cx - 130, b.cy - 95, b.cx + 130, b.cy + 95];
    const bbm: [number, number, number, number] = [b.cx - 260, b.cy - 190, b.cx + 260, b.cy + 190];

    const setup = (
      svg: SVGSVGElement | null,
      pid: string,
      box: [number, number, number, number],
      layerMask: Record<string, boolean>
    ) => {
      if (!svg) return;
      svg.innerHTML = worldSVG(ev, ev.city, pid, box, { big: true });
      svg.setAttribute('viewBox', `${box[0]} ${box[1]} ${box[2] - box[0]} ${box[3] - box[1]}`);
      svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      applyWorldLayers(svg, layerMask, pid, ev, t, null);
    };

    setup(nowSvgRef.current, 'bn', bb, {
      vec: false,
      pre: true,
      now: true,
      fp: false,
      util: false,
      poly: false,
      dmg: true,
      lab: false,
    });
    setup(preSvgRef.current, 'bp', bb, {
      vec: false,
      pre: true,
      now: false,
      fp: false,
      util: false,
      poly: false,
      dmg: false,
      lab: true,
    });
    setup(mapSvgRef.current, 'bm', bbm, {
      vec: true,
      pre: false,
      now: false,
      fp: false,
      util: false,
      poly: true,
      dmg: true,
      lab: true,
    });

    if (preSvgRef.current) {
      const dyn = preSvgRef.current.querySelector('.dyn');
      if (dyn) {
        dyn.innerHTML = `<rect x="${b.x - 3}" y="${b.y - 3}" width="${b.w + 6}" height="${b.h + 6}" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="4 3"/>`;
      }
    }
    if (mapSvgRef.current) {
      const dyn = mapSvgRef.current.querySelector('.dyn');
      if (dyn) {
        dyn.innerHTML =
          `<rect x="${b.x - 4}" y="${b.y - 4}" width="${b.w + 8}" height="${b.h + 8}" fill="#ff6a2b55" stroke="#ff6a2b" stroke-width="2.5"/><circle cx="${b.cx}" cy="${b.cy}" r="70" fill="none" stroke="#ff6a2b" stroke-dasharray="5 4"/>` +
          ev.hits
            .filter((x) => x.id !== bid)
            .map((x) => {
              const o = ev.city.bl[x.id];
              return `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${SEV[x.sev].col}33" stroke="${SEV[x.sev].col}"/>`;
            })
            .join('');
      }
    }
  }, [ev, bid, h?.sev]);

  // Update dynamic drone/IMSI/OSINT overlay on Current Aerial
  useEffect(() => {
    const svg = nowSvgRef.current;
    if (!svg || !b || !h) return;
    applyWorldLayers(
      svg,
      {
        vec: false,
        pre: true,
        now: true,
        fp: false,
        util: false,
        poly: false,
        dmg: true,
        lab: false,
      },
      'bn',
      ev,
      t,
      bnowMode === 'swipe' ? swipeX : null
    );
    const dyn = svg.querySelector('.dyn');
    if (dyn) {
      dyn.innerHTML =
        `<rect x="${b.x - 3}" y="${b.y - 3}" width="${b.w + 6}" height="${b.h + 6}" fill="none" stroke="#fff" stroke-width="1" stroke-dasharray="4 3"/>` +
        dynSVG(ev, t, 0.5, {
          imsi: true,
          osint: true,
          drone: true,
          only: bid,
          lbl: true,
          cov: true,
          swx: bnowMode === 'swipe' ? swipeX : null,
          swy: b.cy,
        });
    }
  }, [ev, bid, b, h, t, bnowMode, swipeX, ev.ver, ev.sms]);

  if (!b || !h) {
    return (
      <div className="p-6 text-sm text-[#929ba2]">
        Building file not found.{' '}
        <button type="button" onClick={onBackToArea} className="text-[#45c4ea] underline">
          Return to area view
        </button>
      </div>
    );
  }

  const ordered = useMemo(() => orderedHits(ev), [ev, ev.priorityOrder, ev.hits.length]);
  const rank = getBuildingRank(ev, bid);
  const reason = ev.priorityReasons[bid] ?? '';
  const layers = lays(ev, h, t);
  const completeCount = layers.filter((x) => x.ok).length;

  const idx = ev.hits.indexOf(h);
  const prevId = ev.hits[(idx - 1 + ev.hits.length) % ev.hits.length].id;
  const nextId = ev.hits[(idx + 1) % ev.hits.length].id;

  const ov = orthoV(t);
  const nowWaitPct =
    t < ev.fb.T0 ? null : clamp((t - ev.fb.T0) / Math.max(1, h.cov - ev.fb.T0), 0, 1);

  const o3Overlay =
    h.os != null && t < h.os
      ? {
          status: 'Queued',
          title: 'Queued for 3D orbit',
          sub: `${h.dr} starts orbit at ${fT(h.os)}. Model target on screen ≤120 min after landing.`,
          pct: null as number | null,
        }
      : h.oe != null && t < h.oe
        ? {
            status: 'In progress',
            title: `${h.dr} orbiting the building`,
            sub: 'Oblique photos for the Gaussian splat',
            pct: (t - (h.os || 0)) / Math.max(1, h.oe - (h.os || 0)),
          }
        : h.mr != null && t < h.mr
          ? {
              status: 'In progress',
              title: 'Building the 3D model',
              sub: 'Gaussian splat on the field GPU',
              pct: (t - (h.oe || 0)) / Math.max(1, h.mr - (h.oe || 0)),
            }
          : null;

  const gOk = t >= h.l4g;
  const mOk = h.l4m != null && t >= h.l4m;
  const svReady = svSource === 'm' ? mOk : gOk;

  const rs = resSum(h, t);
  const bMsgs = msgsAt(ev, t, bid);
  const detectedPhones = h.dev.filter((d) => t >= d.t2);
  const model = cmodel(b, h);

  return (
    <div className="min-h-full pb-20 md:pb-8">
      {/* Header */}
      <div className="md:sticky md:top-0 z-20 bg-[#15191c] border-b border-[#2c3338] px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <button
            type="button"
            onClick={onBackToArea}
            className="min-h-[36px] text-sm font-medium text-[#45c4ea] hover:underline cursor-pointer whitespace-nowrap"
          >
            ← Area
          </button>

          <div>
            <h1 className="font-cond text-xl md:text-2xl font-semibold text-[#e7eaec] leading-tight">
              {b.addr}
            </h1>
            <div className="text-xs text-[#929ba2]">
              {ev.loc.city} · entrance {b.ent} · file opened {fT(h.at)}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-[#929ba2]">
            <select
              aria-label="Building severity"
              value={h.sev}
              onChange={(e) => onChangeSeverity(bid, e.target.value as SeverityKey)}
              className="min-h-[36px] bg-[#1b2024] border border-[#2c3338] rounded-md px-2.5 py-1 text-xs font-medium text-[#e7eaec]"
            >
              {(Object.keys(SEV) as SeverityKey[]).map((k) => (
                <option key={k} value={k}>
                  {SEV[k].n}
                </option>
              ))}
            </select>
            <span>{b.floors} floors</span>
            <span aria-hidden="true">·</span>
            <span>{b.units} flats</span>
            <span aria-hidden="true">·</span>
            <span>built {b.year}</span>
            <span aria-hidden="true">·</span>
            <span className="hidden xl:inline">{b.cons}</span>
            <span className="hidden xl:inline" aria-hidden="true">
              ·
            </span>
            <span>{b.shelter}</span>
          </div>

          {/* Commander Priority (No computed score) */}
          <div className="flex items-center gap-2 border-l border-[#2c3338] pl-4">
            <div>
              <div className="text-[11px] text-[#929ba2]">Commander priority</div>
              <div className="flex items-center gap-2">
                <b className="font-cond text-base text-[#e7eaec] tabular-nums">
                  {rank != null ? `Rank #${rank} of ${ev.hits.length}` : 'Not ranked'}
                </b>
                {rank != null ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditingReason((v) => !v)}
                      className="text-xs text-[#45c4ea] hover:underline cursor-pointer"
                    >
                      {editingReason ? 'Done' : reason ? 'Edit reason' : 'Add reason'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onUnrankBuilding(bid)}
                      className="text-xs text-[#929ba2] hover:text-white cursor-pointer"
                    >
                      Unrank
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onRankBuilding(bid);
                      setEditingReason(true);
                    }}
                    className="px-2 py-0.5 rounded bg-[#232a2f] border border-[#2c3338] hover:border-[#45c4ea] text-xs text-[#e7eaec] cursor-pointer"
                  >
                    Set rank
                  </button>
                )}
              </div>
              {reason && !editingReason && (
                <div className="text-xs text-[#929ba2] max-w-[240px] truncate">{reason}</div>
              )}
            </div>
          </div>

          {/* File Completeness */}
          <div className="min-w-[125px]">
            <div className="text-[11px] text-[#929ba2]">File complete</div>
            <div className="flex items-center gap-2">
              <b className="font-cond text-base text-[#e7eaec] tabular-nums">{completeCount}/10</b>
              <div className="w-16 h-1.5 bg-[#232a2f] rounded overflow-hidden">
                <div
                  className="h-full bg-[#45c4ea]"
                  style={{ width: `${completeCount * 10}%` }}
                />
              </div>
            </div>
          </div>

          {/* Team */}
          <label className="flex items-center gap-2 text-xs text-[#929ba2]">
            <span>Team</span>
            <select
              aria-label="Assigned rescue team"
              value={ev.team[bid] || 'Unassigned'}
              onChange={(e) =>
                onAssignTeam(bid, e.target.value === 'Unassigned' ? null : e.target.value)
              }
              className="min-h-[36px] bg-[#1b2024] border border-[#2c3338] rounded-md px-2 py-1 text-xs text-[#e7eaec]"
            >
              {SRC_IL.teams.map((tm) => (
                <option key={tm} value={tm}>
                  {tm}
                </option>
              ))}
            </select>
          </label>

          {/* Prev / Next */}
          <div className="flex items-center gap-3 ml-auto text-sm font-medium">
            <button
              type="button"
              onClick={() => onOpenBuilding(prevId)}
              className="min-h-[36px] px-2 text-[#45c4ea] hover:underline cursor-pointer whitespace-nowrap"
            >
              ‹ Prev
            </button>
            <button
              type="button"
              onClick={() => onOpenBuilding(nextId)}
              className="min-h-[36px] px-2 text-[#45c4ea] hover:underline cursor-pointer whitespace-nowrap"
            >
              Next ›
            </button>
          </div>
        </div>

        {editingReason && rank != null && (
          <div className="mt-2.5 pt-2.5 border-t border-[#2c3338] flex items-center gap-2 max-w-xl">
            <input
              type="text"
              value={reason}
              onChange={(e) => onSetRankReason(bid, e.target.value)}
              placeholder="Write commander's priority reason for this building…"
              className="flex-1 min-h-[38px] bg-[#1b2024] border border-[#2c3338] rounded-md px-3 py-1.5 text-xs text-[#e7eaec]"
            />
            <button
              type="button"
              onClick={() => setEditingReason(false)}
              className="min-h-[38px] px-3 rounded-md bg-[#232a2f] border border-[#2c3338] text-xs text-[#e7eaec] cursor-pointer"
            >
              Save
            </button>
          </div>
        )}
      </div>

      {/* 10-Pane Evidence Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3 p-3 md:p-4">
        {/* 1. Current aerial (drone) */}
        <section className="xl:col-span-3 h-[340px] md:h-[430px] bg-[#15191c] border border-[#2c3338] rounded-lg grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#2c3338] flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-cond text-sm font-semibold text-[#e7eaec]">
                Current aerial (drone)
              </h3>
              <span className="text-xs text-[#929ba2] truncate">
                {t < h.cov
                  ? 'Awaiting drone pass'
                  : ov
                    ? `Orthophoto ${ov[1]} · ${fT(ov[0])}`
                    : 'M-1 live preview'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <SimulatedBadge />
              <LayerStatusChip
                status={t < h.cov ? 'Pending' : ov ? 'Ready' : 'Loading'}
                etaLabel={t < h.cov ? `ETA ${fT(h.cov)}` : ov ? 'Ready' : 'Preview'}
              />
            </div>
          </header>
          <div className="relative min-h-0 overflow-hidden bg-[#0b0d0f]">
            <svg
              ref={nowSvgRef}
              className="w-full h-full block touch-none select-none"
              onPointerDown={(e) => {
                if (bnowMode === 'swipe') {
                  draggingSwipeRef.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                }
              }}
              onPointerMove={(e) => {
                if (draggingSwipeRef.current && nowSvgRef.current) {
                  setSwipeX(svgPt(nowSvgRef.current, e.clientX, e.clientY).x);
                }
              }}
              onPointerUp={() => {
                draggingSwipeRef.current = false;
              }}
            />
            <div className="absolute top-2 left-2 z-10 inline-flex border border-[#2c3338] rounded-md overflow-hidden bg-[#1b2024]/95">
              <button
                type="button"
                onClick={() => setBnowMode('now')}
                className={`min-h-[32px] px-2.5 text-xs border-r border-[#2c3338] cursor-pointer ${
                  bnowMode === 'now'
                    ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                    : 'text-[#e7eaec]'
                }`}
              >
                Now
              </button>
              <button
                type="button"
                onClick={() => setBnowMode('swipe')}
                className={`min-h-[32px] px-2.5 text-xs cursor-pointer ${
                  bnowMode === 'swipe'
                    ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                    : 'text-[#e7eaec]'
                }`}
              >
                Swipe
              </button>
            </div>
            {t < h.cov && (
              <WaitOverlay
                title={t < ev.fb.T0 ? 'Drone not launched yet' : 'Drone on its way to this building'}
                sub={`Mapping drone M-1 passes over at ${fT(h.cov)}. The pre-disaster image is shown until then.`}
                pct={nowWaitPct}
                translucent
              />
            )}
          </div>
        </section>

        {/* 2. 3D model */}
        <section className="xl:col-span-3 h-[340px] md:h-[430px] bg-[#15191c] border border-[#2c3338] rounded-lg grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#2c3338] flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-cond text-sm font-semibold text-[#e7eaec]">3D model</h3>
              <span className="text-xs text-[#929ba2] truncate">
                Gaussian splat · {h.dr ?? 'O-1'} orbit
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <SimulatedBadge />
              <LayerStatusChip status={o3Overlay ? o3Overlay.status : 'Ready'} />
            </div>
          </header>
          <div className="relative min-h-0 overflow-hidden bg-[#0b0d0f]">
            <Canvas3DView
              resetKey={`${bid}-${h.sev}`}
              autoRotate={autoRotate && !o3Overlay}
              deps={[bid, h.sev, t, xrayPhones, Boolean(o3Overlay)]}
              draw={(ctx, w, hgt, cam) => draw3DB(ctx, w, hgt, cam, b, h, t, xrayPhones)}
            />
            <div className="absolute top-2 left-2 z-10 inline-flex border border-[#2c3338] rounded-md overflow-hidden bg-[#1b2024]/95">
              <button
                type="button"
                onClick={() => setXrayPhones((v) => !v)}
                className={`min-h-[32px] px-2.5 text-xs border-r border-[#2c3338] cursor-pointer ${
                  xrayPhones
                    ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                    : 'text-[#e7eaec]'
                }`}
              >
                X-ray phones
              </button>
              <button
                type="button"
                onClick={() => setAutoRotate((v) => !v)}
                className={`min-h-[32px] px-2.5 text-xs cursor-pointer ${
                  autoRotate
                    ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                    : 'text-[#e7eaec]'
                }`}
              >
                Auto-rotate
              </button>
            </div>
            {o3Overlay && (
              <WaitOverlay
                title={o3Overlay.title}
                sub={o3Overlay.sub}
                pct={o3Overlay.pct}
              />
            )}
          </div>
        </section>

        {/* 3. Location */}
        <section className="xl:col-span-2 h-[320px] bg-[#15191c] border border-[#2c3338] rounded-lg grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#2c3338]">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-cond text-sm font-semibold text-[#e7eaec]">Location</h3>
              <span className="text-xs text-[#929ba2] truncate">{SRC_IL.base[1]} · GIS</span>
            </div>
            <div className="flex items-center gap-1.5">
              <SimulatedBadge />
              <LayerStatusChip status={t >= h.l1 ? 'Ready' : 'Loading'} />
            </div>
          </header>
          <div className="relative min-h-0 overflow-hidden bg-[#0b0d0f]">
            <svg ref={mapSvgRef} className="w-full h-full block" />
            {t < h.l1 && (
              <WaitOverlay title="Loading from offline pack" sub="L1 base map" pct={null} />
            )}
          </div>
        </section>

        {/* 4. Pre-disaster aerial */}
        <section className="xl:col-span-2 h-[320px] bg-[#15191c] border border-[#2c3338] rounded-lg grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#2c3338]">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-cond text-sm font-semibold text-[#e7eaec]">
                Pre-disaster aerial
              </h3>
              <span className="text-xs text-[#929ba2] truncate">
                {SRC_IL.base[ev.srcIdx].split(' (')[0]}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <SimulatedBadge />
              <LayerStatusChip status={t >= h.l2 ? 'Ready' : 'Loading'} />
            </div>
          </header>
          <div className="relative min-h-0 overflow-hidden bg-[#0b0d0f]">
            <svg ref={preSvgRef} className="w-full h-full block" />
            {t < h.l2 && (
              <WaitOverlay title="Loading from offline pack" sub="L2 aerial" pct={null} />
            )}
          </div>
        </section>

        {/* 5. Street view */}
        <section className="xl:col-span-2 h-[320px] bg-[#15191c] border border-[#2c3338] rounded-lg grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#2c3338]">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-cond text-sm font-semibold text-[#e7eaec]">Street view</h3>
              <span className="text-xs text-[#929ba2] truncate">
                {svSource === 'm'
                  ? 'Mapillary · offline cache'
                  : `Google · pano CAoSL${(b.id * 7919).toString(36).toUpperCase()}…`}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <SimulatedBadge />
              <LayerStatusChip
                status={
                  svReady ? 'Ready' : svSource === 'g' && t < 25 ? 'Needs Starlink' : 'Loading'
                }
              />
            </div>
          </header>
          <div className="relative min-h-0 overflow-hidden bg-[#0b0d0f]">
            {svReady && (
              <svg
                viewBox="0 0 400 240"
                preserveAspectRatio="xMidYMid slice"
                className="w-full h-full block"
                dangerouslySetInnerHTML={{
                  __html: facadeSVG(b, 400, 240, svSource === 'g'),
                }}
              />
            )}
            <div className="absolute top-2 left-2 z-10 inline-flex border border-[#2c3338] rounded-md overflow-hidden bg-[#1b2024]/95">
              <button
                type="button"
                disabled={!h.l4m}
                onClick={() => setSvSource('m')}
                className={`min-h-[32px] px-2.5 text-xs border-r border-[#2c3338] disabled:opacity-40 cursor-pointer ${
                  svSource === 'm'
                    ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                    : 'text-[#e7eaec]'
                }`}
              >
                Mapillary
              </button>
              <button
                type="button"
                onClick={() => setSvSource('g')}
                className={`min-h-[32px] px-2.5 text-xs cursor-pointer ${
                  svSource === 'g'
                    ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                    : 'text-[#e7eaec]'
                }`}
              >
                Google
              </button>
            </div>
            {!svReady && (
              <WaitOverlay
                title={svSource === 'g' && t < 25 ? 'Online only' : 'Loading street view'}
                sub={
                  svSource === 'g'
                    ? `We store only the pano ID. Loads once Starlink connects (${fT(25)}).`
                    : 'From the offline cache'
                }
                pct={null}
              />
            )}
          </div>
        </section>

        {/* 6. Blueprint and architecture */}
        <section className="xl:col-span-2 h-[370px] bg-[#15191c] border border-[#2c3338] rounded-lg grid grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
          <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#2c3338]">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-cond text-sm font-semibold text-[#e7eaec]">
                Blueprint and architecture
              </h3>
              <span className="text-xs text-[#929ba2] truncate">
                {t < h.bpT
                  ? `Requested from ${SRC_IL.arch}`
                  : h.bpA
                    ? `Permit plan ${b.year} · scanned`
                    : 'Inferred from footprint'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <SimulatedBadge />
              <LayerStatusChip
                status={
                  t >= h.bpT
                    ? h.bpA
                      ? 'Received'
                      : 'Inferred'
                    : t >= 25
                      ? 'Requested'
                      : 'Needs Starlink'
                }
              />
            </div>
          </header>
          <div className="relative min-h-0 overflow-hidden bg-[#0f2a38]">
            {t >= h.bpT && (
              <svg
                viewBox="0 0 380 250"
                className="w-full h-full block"
                dangerouslySetInnerHTML={{
                  __html: planSVG(b, h, selectedFloor, t),
                }}
              />
            )}
            {t < h.bpT && (
              <WaitOverlay
                title={t < 25 ? 'Needs Starlink' : 'Plans requested'}
                sub={`${SRC_IL.arch} · expected around ${fT(h.bpT)}`}
                pct={null}
              />
            )}
          </div>
          <div className="flex items-center gap-1 px-2.5 py-2 border-t border-[#2c3338] overflow-x-auto">
            <span className="text-xs text-[#929ba2] mr-1 shrink-0">Floor</span>
            {Array.from({ length: b.floors }, (_, i) => {
              const nPhones = h.dev.filter((d) => d.floor === i && loc3(d, t)).length;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedFloor(i)}
                  className={`min-h-[32px] min-w-[34px] px-2 rounded border text-xs cursor-pointer shrink-0 ${
                    selectedFloor === i
                      ? 'bg-[#2d3a42] border-[#45c4ea] text-white'
                      : nPhones
                        ? 'bg-[#1b2024] border-[#ff3fa4] text-[#e7eaec]'
                        : 'bg-[#1b2024] border-[#2c3338] text-[#929ba2]'
                  }`}
                >
                  {fl(i)}
                  {nPhones > 0 && <span className="text-[#ff3fa4] ml-1">•{nPhones}</span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* 7. Residents (Names hidden · Simulated) */}
        <section className="xl:col-span-2 h-[370px] bg-[#15191c] border border-[#2c3338] rounded-lg grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#2c3338]">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-cond text-sm font-semibold text-[#e7eaec]">Residents</h3>
              <span className="text-xs text-[#929ba2] truncate">{SRC_IL.res}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <SimulatedBadge />
              <LayerStatusChip status={t < h.resT ? 'Requested' : 'Live'} />
            </div>
          </header>
          <div className="p-3 overflow-y-auto text-xs">
            {t < h.resT ? (
              <p className="text-[#929ba2] m-0">
                Residents register requested. Expected around {fT(h.resT)}.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <StatusChip>{rs.reg} registered</StatusChip>
                  <StatusChip tone="ok">{rs.loc} located</StatusChip>
                  <StatusChip tone="crit">{rs.miss} reported missing</StatusChip>
                  <StatusChip>{rs.unk} unknown</StatusChip>
                </div>
                <p className="text-[#929ba2] mb-2">
                  Names hidden · role-based access · flat & floor register
                </p>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-left text-[#929ba2] border-b border-[#2c3338]">
                      <th className="py-1.5 pr-2 font-medium">Apt</th>
                      <th className="py-1.5 pr-2 font-medium">Fl</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Reg.</th>
                      <th className="py-1.5 pr-2 font-medium">Status</th>
                      <th className="py-1.5 text-right font-medium">Phones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.units
                      .filter((u) => u.reg > 0)
                      .sort(
                        (a, c) =>
                          Number(resStat(h, c, t) === 'Reported missing') -
                            Number(resStat(h, a, t) === 'Reported missing') || c.floor - a.floor
                      )
                      .map((u) => {
                        const st = resStat(h, u, t);
                        const nFloorPhones = h.dev.filter(
                          (d) => d.floor === u.floor && loc3(d, t)
                        ).length;
                        return (
                          <tr key={u.apt} className="border-b border-[#22292e]">
                            <td className="py-1.5 pr-2 tabular-nums">{u.apt}</td>
                            <td className="py-1.5 pr-2">{fl(u.floor)}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">{u.reg}</td>
                            <td className="py-1.5 pr-2">
                              {st === 'Reported missing' ? (
                                <b className="text-[#ff8a70]">{st}</b>
                              ) : st?.startsWith('Located') ? (
                                <span className="text-[#9fdcf0]">{st}</span>
                              ) : (
                                <span className="text-[#929ba2]">{st ?? 'Pending'}</span>
                              )}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">
                              {nFloorPhones > 0 && (
                                <span className="text-[#ff3fa4]">{nFloorPhones} on floor</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </section>

        {/* 8. Reports (OSINT and hotlines) */}
        <section className="xl:col-span-2 h-[370px] bg-[#15191c] border border-[#2c3338] rounded-lg grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#2c3338]">
            <h3 className="font-cond text-sm font-semibold text-[#e7eaec]">
              Reports (OSINT and hotlines)
            </h3>
            <div className="flex items-center gap-1.5">
              <SimulatedBadge />
              <StatusChip tone={bMsgs.length ? 'ok' : 'neutral'}>
                {pl(bMsgs.length, 'report')}
              </StatusChip>
            </div>
          </header>
          <div className="p-3 overflow-y-auto space-y-2">
            {bMsgs.length > 0 ? (
              bMsgs.map((m) => (
                <MessageCard
                  key={m.id}
                  ev={ev}
                  m={m}
                  t={t}
                  showBuilding={false}
                  onVerify={onVerifyMsg}
                />
              ))
            ) : (
              <p className="text-xs text-[#929ba2] m-0">
                No reports linked to this building yet. Incoming messages are matched to the
                building by address, floor and apartment.
              </p>
            )}
          </div>
        </section>

        {/* 9. Phones detected (IMSI · Phase 2 · Simulated) */}
        <section className="xl:col-span-4 h-[370px] bg-[#15191c] border border-[#2c3338] rounded-lg grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#2c3338] flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-cond text-sm font-semibold text-[#e7eaec]">
                Phones detected (IMSI)
              </h3>
              <span className="text-xs text-[#929ba2] truncate">
                Active cellular locator on drone
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <SimulatedBadge phase2 />
              <StatusChip tone={detectedPhones.length ? 'mg' : 'neutral'}>
                {detectedPhones.filter((d) => loc3(d, t)).length} 3D · {detectedPhones.length}{' '}
                detected
              </StatusChip>
            </div>
          </header>
          <div className="p-3 overflow-auto text-xs space-y-2.5">
            <div className="bg-[#2a1222] border border-[#5a2347] rounded-md px-3 py-2 text-[#ffc4e3]">
              Phase 2 layer: active cellular locator (RES-Q-CELL class, &lt;3 m in 3D). Pending
              spectrum licence. Simulated data.
            </div>

            {detectedPhones.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-left text-[#929ba2] border-b border-[#2c3338]">
                      <th className="py-1.5 pr-2 font-medium">Phone</th>
                      <th className="py-1.5 pr-2 font-medium">Network</th>
                      <th className="py-1.5 pr-2 font-medium">Detected</th>
                      <th className="py-1.5 pr-2 font-medium">Fix</th>
                      <th className="py-1.5 pr-2 font-medium">Floor / height now</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Signal</th>
                      <th className="py-1.5 pr-2 font-medium">Status</th>
                      <th className="py-1.5 font-medium">SMS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detectedPhones.map((d) => {
                      const l = loc3(d, t);
                      const key = `${bid}-${d.k}`;
                      const smsSent = ev.sms[key];
                      const hgt = model.z(d.floor, d.fx, d.fy) + 0.8;

                      return (
                        <tr key={d.k} className="border-b border-[#22292e]">
                          <td className="py-2 pr-2 whitespace-nowrap">
                            <b className="text-[#e7eaec]">P{d.k + 1}</b>{' '}
                            <span className="text-[#929ba2] font-mono-tab">{d.imsi}</span>
                          </td>
                          <td className="py-2 pr-2">{d.carrier}</td>
                          <td className="py-2 pr-2 font-mono-tab">{fT(d.t2)}</td>
                          <td className="py-2 pr-2">
                            {l ? (
                              <b className="text-[#ff8fc8]">3D ±{d.acc.toFixed(1)} m</b>
                            ) : h.os != null && t >= h.os ? (
                              '2D ±20 m · orbit running'
                            ) : (
                              `2D ±20 m · 3D at orbit ${h.os != null ? fT(h.os) : '—'}`
                            )}
                          </td>
                          <td className="py-2 pr-2 tabular-nums">
                            {l ? `Floor ${fl(d.floor)} · ${hgt.toFixed(1)} m above ground` : '—'}
                          </td>
                          <td className="py-2 pr-2 text-right font-mono-tab">{d.rssi} dBm</td>
                          <td className="py-2 pr-2 whitespace-nowrap">
                            {alive(d, t)
                              ? 'Active'
                              : `Signal lost ${d.dead != null ? fT(d.dead) : ''}`}
                          </td>
                          <td className="py-2">
                            {!l && !alive(d, t) ? (
                              <span className="text-[#929ba2]">—</span>
                            ) : smsSent == null ? (
                              <button
                                type="button"
                                onClick={() => onSendSms(bid, d.k)}
                                className="min-h-[30px] px-2.5 py-1 rounded bg-[#232a2f] border border-[#2c3338] hover:border-[#ff3fa4] text-xs cursor-pointer whitespace-nowrap"
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
            ) : (
              <p className="text-[#929ba2] m-0">
                {t < h.cov
                  ? `No scan of this building yet. The drone passes at ${fT(h.cov)}.`
                  : 'No phones detected so far.'}
              </p>
            )}
          </div>
        </section>

        {/* 10. Data layers in this file */}
        <section className="xl:col-span-2 h-[370px] bg-[#15191c] border border-[#2c3338] rounded-lg grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#2c3338]">
            <h3 className="font-cond text-sm font-semibold text-[#e7eaec]">
              Data layers in this file
            </h3>
            <div className="flex items-center gap-1.5">
              <SimulatedBadge />
              <StatusChip tone={completeCount === 10 ? 'ok' : 'ld'}>
                {completeCount}/10
              </StatusChip>
            </div>
          </header>
          <div className="p-3 overflow-y-auto divide-y divide-[#22292e]">
            {layers.map((x) => (
              <div
                key={x.k}
                className="grid grid-cols-[34px_minmax(0,1fr)_auto] gap-2 items-center py-2 text-xs"
              >
                <code className="font-cond font-semibold text-[#929ba2]">{x.k}</code>
                <div className="min-w-0">
                  <div className="text-[#e7eaec] truncate">{x.n}</div>
                  <div className="text-[#929ba2] truncate">{x.s}</div>
                </div>
                {x.r == null ? (
                  <StatusChip>None</StatusChip>
                ) : x.ok ? (
                  <LayerStatusChip
                    status={x.status}
                    etaLabel={x.status === 'Inferred' ? `Inferred · ${fT(x.r)}` : fT(x.r)}
                  />
                ) : (
                  <LayerStatusChip
                    status={x.status}
                    etaLabel={
                      x.status === 'Needs Starlink'
                        ? 'Needs Starlink'
                        : x.status === 'Loading'
                          ? 'Loading'
                          : `ETA ${x.r < 1e8 ? fT(x.r) : '—'}`
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function WaitOverlay({
  title,
  sub,
  pct,
  translucent = false,
}: {
  title: string;
  sub: string;
  pct: number | null;
  translucent?: boolean;
}) {
  return (
    <div
      className={`absolute inset-0 z-10 flex flex-col items-center justify-center text-center p-5 gap-2 ${
        translucent ? 'bg-[#0e1113]/65' : 'bg-[#0e1113]/85'
      }`}
    >
      <b className="font-cond text-base text-[#e7eaec]">{title}</b>
      <span className="text-xs text-[#929ba2] max-w-xs">{sub}</span>
      {pct != null && (
        <div className="w-52 h-1.5 bg-[#232a2f] rounded overflow-hidden mt-1">
          <div
            className="h-full bg-[#45c4ea] transition-all duration-150"
            style={{ width: `${Math.round(pct * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
