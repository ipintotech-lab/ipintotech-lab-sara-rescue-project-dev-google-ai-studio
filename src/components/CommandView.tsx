import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Building,
  CityModel,
  EventState,
  EventType,
  LocationPack,
  SeverityKey,
} from '../types/sara';
import {
  EVENT_TYPES,
  LOCS,
  SEV,
  SRC_IL,
  clamp,
  clockStr,
  fT,
  genCity,
  inPoly,
  makeEvent,
  msgsAt,
  pl,
  rng,
} from '../sim/engine';
import { applyWorldLayers, bAt, fitVB, svgPt, worldSVG } from '../sim/renderers';
import { createSearchedLocationPack } from '../lib/mapsConfig';
import {
  CommandLocationPreviewMap,
  CommandStep2GoogleMap,
  GoogleAddressSearchBar,
  type SearchedPlaceResult,
} from './GoogleMapsPanes';
import { GoogleSignInButton } from './GoogleSignInButton';
import { SeverityChip, SimulatedBadge, StatusChip } from './StatusChip';
import type { MeetSpaceItem, PickedDriveFile } from '../types/sara';

interface CommandViewProps {
  ev: EventState | null;
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
  onStartEvent: (ev: EventState, goToArea: boolean) => void;
  onLoadDemo: () => void;
  onOpenArea: () => void;
  onOpenBuilding: (id: number) => void;
}

export function CommandView({
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
  onStartEvent,
  onLoadDemo,
  onOpenArea,
  onOpenBuilding,
}: CommandViewProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [eventType, setEventType] = useState<EventType>('Missile strike');
  const [searchedPlace, setSearchedPlace] = useState<SearchedPlaceResult | null>(null);
  const [selectedLoc, setSelectedLoc] = useState<LocationPack | null>(null);
  const [city, setCity] = useState<CityModel | null>(null);
  const [eventDate, setEventDate] = useState('2026-11-20T13:29');
  const [srcIdx, setSrcIdx] = useState(0);
  const [bsrcIdx, setBsrcIdx] = useState(0);

  // Step 2 map state
  const [tool, setTool] = useState<'select' | 'poly'>('select');
  const [mapMode, setMapMode] = useState<'pre' | 'gis' | 'gmap'>('pre');
  const [sel, setSel] = useState<Map<number, SeverityKey>>(() => new Map());
  const [poly, setPoly] = useState<[number, number][]>([]);
  const [polyClosed, setPolyClosed] = useState(false);
  const [hoverB, setHoverB] = useState<Building | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [cursorPt, setCursorPt] = useState<{ x: number; y: number } | null>(null);
  const [vb, setVb] = useState<[number, number, number, number]>([0, 0, 1200, 800]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    vb: [number, number, number, number];
    moved: boolean;
  } | null>(null);

  const pickLoc = (loc: LocationPack, fromSearch = false) => {
    if (!fromSearch) {
      setSearchedPlace(null);
    }
    setSelectedLoc(loc);
    setCity(genCity(loc));
    setSel(new Map());
    setPoly([]);
    setPolyClosed(false);
  };

  const handleSelectSearchedPlace = (place: SearchedPlaceResult) => {
    setSearchedPlace(place);
    const customLoc = createSearchedLocationPack({
      name: place.name,
      formattedAddress: place.formattedAddress,
      lat: place.lat,
      lng: place.lng,
    });
    pickLoc(customLoc, true);
  };

  // Initialize SVG world when entering step 2
  useEffect(() => {
    if (step !== 2 || !city || !svgRef.current) return;
    const svg = svgRef.current;
    svg.innerHTML = worldSVG(null, city, 'w', [0, 0, city.W, city.H]);
    const initialVb = fitVB(svg, [0, 0, city.W, city.H]);
    setVb(initialVb);
    svg.setAttribute('viewBox', initialVb.join(' '));
    applyWorldLayers(
      svg,
      {
        vec: mapMode === 'gis',
        pre: mapMode === 'pre',
        now: false,
        fp: mapMode === 'pre',
        dmg: false,
        poly: false,
        util: false,
      },
      'w',
      null,
      0,
      null
    );
  }, [step, city]);

  // Apply layer toggles when mapMode switches
  useEffect(() => {
    if (step !== 2 || !svgRef.current) return;
    applyWorldLayers(
      svgRef.current,
      {
        vec: mapMode === 'gis',
        pre: mapMode === 'pre',
        now: false,
        fp: mapMode === 'pre',
        dmg: false,
        poly: false,
        util: false,
      },
      'w',
      null,
      0,
      null
    );
  }, [mapMode, step]);

  // Draw dynamic selection & polygon overlay in step 2
  useEffect(() => {
    if (step !== 2 || !city || !svgRef.current) return;
    const svg = svgRef.current;
    svg.setAttribute('viewBox', vb.join(' '));
    const dyn = svg.querySelector('.dyn');
    if (!dyn) return;

    const k = vb[2] / (svg.clientWidth || 800);
    let s = '';
    for (const [id, sv] of sel.entries()) {
      const b = city.bl[id];
      if (!b) continue;
      s += `<rect x="${b.x - 2}" y="${b.y - 2}" width="${b.w + 4}" height="${b.h + 4}" fill="${SEV[sv].col}44" stroke="${SEV[sv].col}" stroke-width="${2.2 * k}"/>`;
    }
    if (hoverB && !sel.has(hoverB.id)) {
      s += `<rect x="${hoverB.x - 2}" y="${hoverB.y - 2}" width="${hoverB.w + 4}" height="${hoverB.h + 4}" fill="#ffffff22" stroke="#fff" stroke-width="${1.5 * k}"/>`;
    }
    if (poly.length > 0) {
      const pts = poly.map((p) => p.join(',')).join(' ');
      if (polyClosed) {
        s += `<polygon points="${pts}" fill="#ff6a2b18" stroke="#ff6a2b" stroke-width="${2 * k}" stroke-dasharray="${7 * k} ${4 * k}"/>`;
      } else {
        s += `<polyline points="${pts}${cursorPt ? ` ${cursorPt.x},${cursorPt.y}` : ''}" fill="none" stroke="#ff6a2b" stroke-width="${2 * k}"/>`;
      }
      poly.forEach((q, i) => {
        s += `<circle cx="${q[0]}" cy="${q[1]}" r="${(i === 0 && !polyClosed ? 7 : 4) * k}" fill="${i === 0 ? '#fff' : '#ff6a2b'}" stroke="#000" stroke-width="${k}"/>`;
      });
    }
    dyn.innerHTML = s;
  }, [step, city, vb, sel, hoverB, poly, polyClosed, cursorPt]);

  // Esc key cancels polygon drawing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step === 2 && !polyClosed) {
        setPoly([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, polyClosed]);

  const closePolygon = (pts = poly) => {
    if (!city || pts.length < 3) return;
    setPolyClosed(true);
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const md = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy)), 1);
    const R = rng(city.seed + pts.length);
    const nextSel = new Map<number, SeverityKey>();
    for (const b of city.bl) {
      const corners: [number, number][] = [
        [b.cx, b.cy],
        [b.x, b.y],
        [b.x + b.w, b.y],
        [b.x, b.y + b.h],
        [b.x + b.w, b.y + b.h],
      ];
      if (corners.some((p) => inPoly(p, pts))) {
        const d = Math.hypot(b.cx - cx, b.cy - cy) / md + R.r(-0.15, 0.15);
        nextSel.set(b.id, d < 0.38 ? 'c' : d < 0.7 ? 'p' : 'd');
      }
    }
    setSel(nextSel);
  };

  const selectedRows = useMemo(() => {
    if (!city) return [];
    return [...sel.entries()]
      .map(([id, sv]) => ({ b: city.bl[id], sv }))
      .filter((x) => x.b != null)
      .sort((a, b) => a.b.addr.localeCompare(b.b.addr, undefined, { numeric: true }));
  }, [city, sel]);

  const selectedRecord = useMemo(() => {
    const rec: Record<number, SeverityKey> = {};
    for (const [id, sv] of sel.entries()) rec[id] = sv;
    return rec;
  }, [sel]);

  const totalFlats = selectedRows.reduce((a, x) => a + x.b.units, 0);

  const handleInitiate = () => {
    if (!selectedLoc || !city || sel.size === 0) return;
    const created = makeEvent(
      selectedLoc,
      city,
      sel,
      polyClosed ? poly : null,
      eventType,
      srcIdx,
      bsrcIdx,
      eventDate
    );
    onStartEvent(created, false);
    setStep(3);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)] min-h-full pb-16 md:pb-0">
      {/* Left Sidebar: Events */}
      <aside className="bg-[#15191c] border-b lg:border-b-0 lg:border-r border-[#2c3338] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-cond text-lg font-semibold text-[#e7eaec]">Events</h2>
          <SimulatedBadge />
        </div>

        {ev ? (
          <div className="bg-[#1b2024] border border-[#45c4ea]/60 rounded-lg p-3 flex flex-col gap-2">
            <div className="font-semibold text-[#e7eaec]">
              {ev.loc.city} · {ev.type}
            </div>
            <div className="text-xs text-[#929ba2]">
              {clockStr(ev, 0)} · {ev.hits.length} buildings
            </div>
            <div className="font-mono-tab text-xs text-[#45c4ea]">{fT(t)}</div>
            <button
              type="button"
              onClick={onOpenArea}
              className="mt-1 min-h-[40px] px-3 py-1.5 rounded-md bg-[#232a2f] border border-[#2c3338] hover:border-[#45c4ea] text-xs font-medium text-[#e7eaec] cursor-pointer"
            >
              Open area view
            </button>
          </div>
        ) : (
          <p className="text-xs text-[#929ba2] m-0">
            No active event. Open a new event when the team is dispatched.
          </p>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
          <button
            type="button"
            onClick={() => setStep(1)}
            className="min-h-[44px] px-3 py-2 rounded-md bg-[#ff6a2b] border border-[#ff6a2b] text-[#160800] font-semibold text-sm hover:brightness-110 cursor-pointer"
          >
            New event
          </button>
          <button
            type="button"
            onClick={onLoadDemo}
            className="min-h-[44px] px-3 py-2 rounded-md bg-[#232a2f] border border-[#2c3338] text-[#e7eaec] font-medium text-sm hover:border-[#46515a] cursor-pointer"
          >
            Load demo event
          </button>
        </div>

        <p className="text-xs text-[#929ba2] m-0 leading-relaxed">
          Demo: missile strike in Bat Yam, 20 Nov 13:29. The affected area is pre-marked with a polygon.
        </p>

        <p className="text-xs text-[#929ba2] mt-auto pt-3 border-t border-[#2c3338]/70 hidden lg:block">
          Simulated C2 data throughout. Israel locations; live Google Maps & Street View active when online (non-operational demo only).
        </p>
      </aside>

      {/* Main Wizard Area */}
      <div className="p-4 md:p-6 overflow-y-auto">
        {/* Stepper */}
        <div className="flex items-center gap-2 flex-wrap mb-5">
          {[
            { n: 1 as const, label: '1 · Location and time' },
            { n: 2 as const, label: '2 · Mark affected buildings' },
            { n: 3 as const, label: '3 · Building files' },
          ].map((item) => {
            const active = step === item.n;
            const done = step > item.n;
            const canClick = item.n === 1 || (item.n === 2 && city != null) || (item.n === 3 && ev != null);
            return (
              <button
                key={item.n}
                type="button"
                disabled={!canClick}
                onClick={() => canClick && setStep(item.n)}
                className={`min-h-[40px] px-3.5 py-1.5 rounded-md border text-xs md:text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#232a2f] border-[#45c4ea] text-white'
                    : done
                      ? 'bg-[#1b2024] border-[#2c3338] text-[#45c4ea]'
                      : 'bg-[#15191c] border-[#2c3338] text-[#929ba2]'
                } ${canClick ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* STEP 1 */}
        {step === 1 && (
          <div className="max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2 flex flex-col gap-1.5">
              <label className="text-xs text-[#929ba2]">Event type</label>
              <div className="flex flex-wrap border border-[#2c3338] rounded-md overflow-hidden bg-[#1b2024] w-fit">
                {EVENT_TYPES.map((tp) => (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => setEventType(tp)}
                    className={`min-h-[42px] px-3.5 py-2 text-xs md:text-sm border-r last:border-r-0 border-[#2c3338] cursor-pointer whitespace-nowrap ${
                      eventType === tp
                        ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                        : 'text-[#e7eaec] hover:bg-[#232a2f]'
                    }`}
                  >
                    {tp}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="qloc" className="text-xs text-[#929ba2]">
                Search any address on Google Maps (street, landmark, or city)
              </label>
              <GoogleAddressSearchBar
                id="qloc"
                placeholder="Search any address, e.g. 12 Rothschild Blvd, Tel Aviv…"
                onSelectPlace={handleSelectSearchedPlace}
              />

              {searchedPlace && selectedLoc && selectedLoc.id.startsWith('search-') && (
                <div className="px-3 py-2 rounded-md border border-[#45c4ea] bg-[#2d3a42] text-white text-xs flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{searchedPlace.name}</div>
                    <div className="text-[#cdeefb] truncate">
                      {searchedPlace.formattedAddress}
                    </div>
                  </div>
                  <span className="text-[11px] text-[#9be5fa] shrink-0">Google Maps</span>
                </div>
              )}

              <div className="text-[11px] text-[#929ba2] pt-1">
                Quick-pick demo sector packs (Israel)
              </div>
              <div className="flex flex-col gap-1.5">
                {LOCS.map((loc) => (
                  <button
                    key={loc.id}
                    type="button"
                    onClick={() => pickLoc(loc)}
                    className={`min-h-[42px] flex items-center justify-between gap-3 px-3 py-2 rounded-md border text-left text-sm cursor-pointer transition-colors ${
                      selectedLoc?.id === loc.id
                        ? 'bg-[#2d3a42] border-[#45c4ea] text-white'
                        : 'bg-[#1b2024] border-[#2c3338] text-[#e7eaec] hover:border-[#46515a]'
                    }`}
                  >
                    <span>{loc.name}</span>
                    <span className="text-xs text-[#929ba2] shrink-0">Israel</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edate" className="text-xs text-[#929ba2]">
                  Date and time of the event
                </label>
                <input
                  id="edate"
                  type="datetime-local"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="min-h-[44px] bg-[#1b2024] border border-[#2c3338] rounded-md px-3 py-2 text-sm text-[#e7eaec]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="esrc" className="text-xs text-[#929ba2]">
                  Pre-disaster aerial and base map (L1/L2)
                </label>
                <select
                  id="esrc"
                  value={srcIdx}
                  onChange={(e) => {
                    const nextIdx = Number(e.target.value);
                    setSrcIdx(nextIdx);
                    if (nextIdx === 2) setMapMode('gmap');
                  }}
                  className="min-h-[44px] bg-[#1b2024] border border-[#2c3338] rounded-md px-3 py-2 text-sm text-[#e7eaec]"
                >
                  {SRC_IL.base.map((x, i) => (
                    <option key={x} value={i}>
                      {x}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="ebsrc" className="text-xs text-[#929ba2]">
                  Building outlines and floors (L3)
                </label>
                <select
                  id="ebsrc"
                  value={bsrcIdx}
                  onChange={(e) => setBsrcIdx(Number(e.target.value))}
                  className="min-h-[44px] bg-[#1b2024] border border-[#2c3338] rounded-md px-3 py-2 text-sm text-[#e7eaec]"
                >
                  {SRC_IL.b.map((x, i) => (
                    <option key={x} value={i}>
                      {x}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Offline pack + live sector preview card */}
            <div className="md:col-span-2 bg-[#15191c] border border-[#2c3338] rounded-lg p-4 space-y-3">
              {selectedLoc && city ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-xs text-[#929ba2]">Selected</div>
                      <div className="font-semibold text-sm text-[#e7eaec] mt-0.5">
                        {selectedLoc.name}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[#929ba2]">Centre</div>
                      <div className="font-mono-tab font-semibold text-sm text-[#e7eaec] mt-0.5">
                        {selectedLoc.ll}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[#929ba2]">Area loaded</div>
                      <div className="font-semibold text-sm text-[#e7eaec] mt-0.5 tabular-nums">
                        600 × 400 m · {city.bl.length} buildings
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[#929ba2]">Offline pack (L1 to L4)</div>
                      <div className="font-semibold text-sm text-[#45c4ea] mt-0.5">
                        1.24 GB · ready on field kit
                      </div>
                    </div>
                  </div>
                  <CommandLocationPreviewMap
                    loc={selectedLoc}
                    satellite={srcIdx === 2}
                    searchedPin={searchedPlace}
                  />
                </>
              ) : (
                <div className="text-xs text-[#929ba2]">
                  Search any address on Google Maps or pick an offline location above to inspect the live Google Map, Street View, and sector grid.
                </div>
              )}
            </div>

            {/* Google Drive attachments (Google Picker) */}
            <div className="md:col-span-2 bg-[#15191c] border border-[#2c3338] rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-cond text-base font-semibold text-[#e7eaec]">
                    Incident plans & briefs (Google Drive)
                  </span>
                  <StatusChip tone={driveFiles.length > 0 ? 'ok' : 'neutral'}>
                    {driveFiles.length} attached
                  </StatusChip>
                </div>
                <p className="text-xs text-[#929ba2] m-0">
                  Use Google Picker to attach architectural plans, PDFs, or spreadsheets from your Google Drive.
                </p>
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
                      className="min-h-[36px] px-3 py-1.5 rounded-md bg-[#232a2f] border border-[#45c4ea]/70 hover:border-[#45c4ea] text-xs font-medium text-[#e7eaec] cursor-pointer disabled:opacity-50"
                    >
                      {drivePicking ? 'Opening Picker…' : 'Pick from Google Drive'}
                    </button>
                    {driveFiles.length > 0 && (
                      <button
                        type="button"
                        onClick={onOpenDriveDrawer}
                        className="min-h-[36px] px-3 py-1.5 rounded-md bg-[#1b2024] border border-[#2c3338] hover:border-[#46515a] text-xs text-[#929ba2] hover:text-white cursor-pointer"
                      >
                        Manage ({driveFiles.length})
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Google Meet briefings */}
            <div className="md:col-span-2 bg-[#15191c] border border-[#2c3338] rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-cond text-base font-semibold text-[#e7eaec]">
                    Command briefings (Google Meet)
                  </span>
                  <StatusChip tone={meetSpaces.length > 0 ? 'ok' : 'neutral'}>
                    {meetSpaces.length} {meetSpaces.length === 1 ? 'room' : 'rooms'}
                  </StatusChip>
                </div>
                <p className="text-xs text-[#929ba2] m-0">
                  Launch and manage Google Meet briefing rooms and inspect recent call records.
                </p>
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
                    className="min-h-[36px] px-3 py-1.5 rounded-md bg-[#232a2f] border border-[#45c4ea]/70 hover:border-[#45c4ea] text-xs font-medium text-[#e7eaec] cursor-pointer"
                  >
                    {meetSpaces.length > 0 ? `Open Meet rooms (${meetSpaces.length})` : 'Create Google Meet'}
                  </button>
                )}
              </div>
            </div>

            <div className="md:col-span-2">
              <button
                type="button"
                disabled={!selectedLoc}
                onClick={() => setStep(2)}
                className="min-h-[44px] px-5 py-2.5 rounded-md bg-[#ff6a2b] text-[#160800] font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 cursor-pointer"
              >
                Open map of the area →
              </button>
            </div>
          </div>
        )}

        {/* STEP 2 */}
        {step === 2 && city && selectedLoc && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4 lg:h-[calc(100vh-200px)] min-h-[540px]">
            {/* Map Canvas */}
            <div className="relative bg-[#111] border border-[#2c3338] rounded-lg overflow-hidden min-h-[380px] h-[55vh] lg:h-full">
              <div className="absolute top-2.5 left-2.5 right-2.5 z-10 flex flex-wrap gap-2 pointer-events-none">
                <div className="pointer-events-auto inline-flex border border-[#2c3338] rounded-md overflow-hidden bg-[#1b2024]/95">
                  <button
                    type="button"
                    onClick={() => setTool('select')}
                    className={`min-h-[40px] px-3 py-1.5 text-xs font-medium border-r border-[#2c3338] cursor-pointer ${
                      tool === 'select'
                        ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                        : 'text-[#e7eaec]'
                    }`}
                  >
                    Select buildings
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTool('poly');
                      if (polyClosed) {
                        setPoly([]);
                        setPolyClosed(false);
                      }
                    }}
                    className={`min-h-[40px] px-3 py-1.5 text-xs font-medium cursor-pointer ${
                      tool === 'poly'
                        ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                        : 'text-[#e7eaec]'
                    }`}
                  >
                    Draw polygon
                  </button>
                </div>

                <div className="pointer-events-auto inline-flex border border-[#2c3338] rounded-md overflow-hidden bg-[#1b2024]/95">
                  <button
                    type="button"
                    onClick={() => setMapMode('pre')}
                    className={`min-h-[40px] px-3 py-1.5 text-xs font-medium border-r border-[#2c3338] cursor-pointer ${
                      mapMode === 'pre'
                        ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                        : 'text-[#e7eaec]'
                    }`}
                  >
                    Aerial (pre-event)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMapMode('gis')}
                    className={`min-h-[40px] px-3 py-1.5 text-xs font-medium border-r border-[#2c3338] cursor-pointer ${
                      mapMode === 'gis'
                        ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                        : 'text-[#e7eaec]'
                    }`}
                  >
                    Map
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMapMode('gmap');
                      if (tool === 'poly') setTool('select');
                    }}
                    className={`min-h-[40px] px-3 py-1.5 text-xs font-medium cursor-pointer ${
                      mapMode === 'gmap'
                        ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                        : 'text-[#e7eaec]'
                    }`}
                  >
                    Google Satellite
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSel(new Map());
                    setPoly([]);
                    setPolyClosed(false);
                  }}
                  className="pointer-events-auto min-h-[40px] px-3 py-1.5 rounded-md bg-[#232a2f]/95 border border-[#2c3338] text-xs font-medium text-[#e7eaec] cursor-pointer"
                >
                  Clear
                </button>

                {tool === 'poly' && !polyClosed && poly.length >= 3 && (
                  <button
                    type="button"
                    onClick={() => closePolygon()}
                    className="pointer-events-auto min-h-[40px] px-3 py-1.5 rounded-md bg-[#ff6a2b] text-[#160800] text-xs font-semibold cursor-pointer"
                  >
                    Close polygon
                  </button>
                )}
              </div>

              {mapMode === 'gmap' && (
                <div className="w-full h-full">
                  <CommandStep2GoogleMap
                    loc={selectedLoc}
                    city={city}
                    selectedIds={selectedRecord}
                    poly={poly}
                    polyClosed={polyClosed}
                    onToggleBuilding={(id) => {
                      setSel((prev) => {
                        const next = new Map(prev);
                        if (next.has(id)) next.delete(id);
                        else next.set(id, 'c');
                        return next;
                      });
                    }}
                  />
                </div>
              )}

              <svg
                ref={svgRef}
                aria-label="Map of the event area"
                className={`w-full h-full touch-none select-none cursor-crosshair ${
                  mapMode === 'gmap' ? 'hidden' : 'block'
                }`}
                onWheel={(e) => {
                  e.preventDefault();
                  const svg = svgRef.current;
                  if (!svg) return;
                  const p = svgPt(svg, e.clientX, e.clientY);
                  const f = Math.exp(e.deltaY * 0.0012);
                  const w = clamp(vb[2] * f, 120, 2400);
                  const r = w / vb[2];
                  setVb([p.x - (p.x - vb[0]) * r, p.y - (p.y - vb[1]) * r, w, vb[3] * r]);
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  dragRef.current = { x: e.clientX, y: e.clientY, vb, moved: false };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const svg = svgRef.current;
                  if (!svg) return;
                  const pt = svgPt(svg, e.clientX, e.clientY);
                  setCursorPt(pt);
                  const b = bAt(city, pt) || null;
                  setHoverB(b);
                  setHoverPos(b ? { x: e.clientX, y: e.clientY } : null);

                  if (!dragRef.current) return;
                  const dx = e.clientX - dragRef.current.x;
                  const dy = e.clientY - dragRef.current.y;
                  if (Math.abs(dx) + Math.abs(dy) > 4) dragRef.current.moved = true;
                  if (dragRef.current.moved) {
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
                    const p = svgPt(svg, e.clientX, e.clientY);
                    if (tool === 'select') {
                      const b = bAt(city, p);
                      if (b) {
                        setSel((prev) => {
                          const next = new Map(prev);
                          if (next.has(b.id)) next.delete(b.id);
                          else next.set(b.id, 'c');
                          return next;
                        });
                      }
                    } else {
                      let basePoly = poly;
                      if (polyClosed) {
                        basePoly = [];
                        setPolyClosed(false);
                        setSel(new Map());
                      }
                      const k = vb[2] / (svg.clientWidth || 800);
                      if (
                        basePoly.length >= 3 &&
                        Math.hypot(p.x - basePoly[0][0], p.y - basePoly[0][1]) < 12 * k
                      ) {
                        closePolygon(basePoly);
                      } else {
                        setPoly([...basePoly, [Math.round(p.x), Math.round(p.y)]]);
                      }
                    }
                  }
                  dragRef.current = null;
                }}
                onPointerLeave={() => {
                  setHoverB(null);
                  setHoverPos(null);
                }}
              />

              <div className="absolute bottom-2.5 left-2.5 right-2.5 md:right-auto md:max-w-[75%] z-10 bg-[#0a0c0e]/90 border border-[#2c3338] rounded-md px-3 py-2 text-xs text-[#e7eaec]">
                {tool === 'select'
                  ? 'Tap or click buildings to mark them (severity can include "No damage"). Scroll to zoom, drag to pan.'
                  : polyClosed
                    ? 'Polygon closed. Buildings inside are selected; adjust any building severity in the list.'
                    : poly.length > 0
                      ? `${poly.length} points. Tap the first point or press "Close polygon" to finish.`
                      : 'Tap or click on the map to place the corners of the affected area.'}
              </div>

              {hoverB && hoverPos && tool === 'select' && (
                <div
                  className="hidden md:block fixed z-30 pointer-events-none bg-[#0a0c0e]/95 border border-[#2c3338] rounded-md px-3 py-2 text-xs max-w-[240px]"
                  style={{ left: hoverPos.x + 14, top: hoverPos.y + 14 }}
                >
                  <div className="font-semibold text-[#e7eaec]">{hoverB.addr}</div>
                  <div className="text-[#e7eaec] mt-0.5">
                    {hoverB.floors} floors · {hoverB.units} flats · built {hoverB.year}
                  </div>
                  <div className="text-[#929ba2] mt-0.5">{hoverB.cons}</div>
                </div>
              )}
            </div>

            {/* Right Sidebar: Selected Hit Buildings */}
            <div className="bg-[#15191c] border border-[#2c3338] rounded-lg flex flex-col min-h-0">
              <div className="px-3.5 py-3 border-b border-[#2c3338]">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-cond text-base font-semibold text-[#e7eaec]">
                    Hit buildings
                  </h3>
                  <SimulatedBadge />
                </div>
                <div className="text-xs text-[#929ba2] mt-0.5 truncate">
                  {SRC_IL.base[srcIdx]} · {SRC_IL.b[bsrcIdx]}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-[300px] lg:max-h-none">
                {selectedRows.length === 0 ? (
                  <p className="text-xs text-[#929ba2] p-2">
                    No buildings marked yet. Tap a building on the map or draw a polygon.
                  </p>
                ) : (
                  selectedRows.map(({ b, sv }) => (
                    <div
                      key={b.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 items-center p-2 rounded-md hover:bg-[#1b2024]"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-[#e7eaec] truncate">
                          {b.addr}
                        </div>
                        <div className="text-xs text-[#929ba2]">
                          {b.floors} floors · {b.units} flats · {b.year}
                        </div>
                      </div>
                      <select
                        aria-label={`Severity for ${b.addr}`}
                        value={sv}
                        onChange={(e) => {
                          const v = e.target.value as SeverityKey;
                          setSel((prev) => {
                            const next = new Map(prev);
                            next.set(b.id, v);
                            return next;
                          });
                        }}
                        className="min-h-[36px] bg-[#1b2024] border border-[#2c3338] rounded px-2 py-1 text-xs text-[#e7eaec]"
                      >
                        {(Object.keys(SEV) as SeverityKey[]).map((k) => (
                          <option key={k} value={k}>
                            {SEV[k].n}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label={`Remove ${b.addr}`}
                        onClick={() =>
                          setSel((prev) => {
                            const next = new Map(prev);
                            next.delete(b.id);
                            return next;
                          })
                        }
                        className="min-h-[36px] min-w-[36px] rounded bg-[#232a2f] border border-[#2c3338] text-sm text-[#e7eaec] hover:border-[#ff4d2e] cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 px-3.5 py-3 border-t border-[#2c3338] text-xs">
                <div>
                  <span className="text-[#929ba2] block">Buildings</span>
                  <b className="font-cond text-xl text-[#e7eaec] tabular-nums">
                    {selectedRows.length}
                  </b>
                </div>
                <div>
                  <span className="text-[#929ba2] block">Flats</span>
                  <b className="font-cond text-xl text-[#e7eaec] tabular-nums">{totalFlats}</b>
                </div>
                <div>
                  <span className="text-[#929ba2] block">Collapsed / partial</span>
                  <b className="font-cond text-xl text-[#e7eaec] tabular-nums">
                    {selectedRows.filter((x) => x.sv === 'c').length} /{' '}
                    {selectedRows.filter((x) => x.sv === 'p').length}
                  </b>
                </div>
                <div>
                  <span className="text-[#929ba2] block">Est. residents</span>
                  <b className="font-cond text-xl text-[#e7eaec] tabular-nums">
                    ≈{Math.round(totalFlats * 2.7)}
                  </b>
                </div>
              </div>

              <div className="p-3.5 pt-0 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={selectedRows.length === 0}
                  onClick={handleInitiate}
                  className="min-h-[44px] w-full rounded-md bg-[#ff6a2b] text-[#160800] font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 cursor-pointer"
                >
                  {selectedRows.length
                    ? `Initiate ${selectedRows.length} building files`
                    : 'Initiate building files'}
                </button>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="min-h-[40px] w-full rounded-md bg-[#232a2f] border border-[#2c3338] text-sm text-[#e7eaec] hover:border-[#46515a] cursor-pointer"
                >
                  ← Back
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3 */}
        {step === 3 && ev && (
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <h2 className="font-cond text-xl font-semibold text-[#e7eaec]">
                {ev.hits.length} building files · {ev.loc.city}
              </h2>
              <SimulatedBadge />
              <div className="ml-auto">
                <button
                  type="button"
                  onClick={onOpenArea}
                  className="min-h-[44px] px-4 py-2 rounded-md bg-[#ff6a2b] text-[#160800] font-semibold text-sm hover:brightness-110 cursor-pointer"
                >
                  Open area view →
                </button>
              </div>
            </div>

            <p className="text-xs text-[#929ba2] mb-4 max-w-3xl">
              Each file starts from the offline layers on the field kit (L1 to L4), then pulls
              OSINT, archive plans and the residents register, and later the drone layers. Tap any
              file to open it.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {ev.hits.map((h) => {
                const b = ev.city.bl[h.id];
                const chipStatus = (readyAt: number | null, label: string, loadAt?: number) => {
                  if (readyAt == null) return <StatusChip key={label}>Pending</StatusChip>;
                  if (t >= readyAt)
                    return (
                      <StatusChip key={label} tone="ok">
                        {label}
                      </StatusChip>
                    );
                  if (loadAt != null && t >= loadAt)
                    return (
                      <StatusChip key={label} tone="ld">
                        {label}
                      </StatusChip>
                    );
                  return <StatusChip key={label}>{label}</StatusChip>;
                };

                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => onOpenBuilding(h.id)}
                    className="text-left bg-[#1b2024] border border-[#2c3338] hover:border-[#4b565e] rounded-lg p-3.5 flex flex-col gap-2.5 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 w-full">
                      <span className="font-semibold text-sm text-[#e7eaec]">{b.addr}</span>
                      <SeverityChip sev={h.sev} />
                    </div>
                    <div className="text-xs text-[#929ba2]">
                      {b.floors} floors · {b.units} flats · {b.cons}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {chipStatus(h.l1, 'L1 map', 0)}
                      {chipStatus(h.l2, 'L2 aerial', 0)}
                      {chipStatus(h.l3, 'L3 floors', 0)}
                      {chipStatus(h.l4m || h.l4g, 'L4 street', 0)}
                      {chipStatus(h.bpT, 'Plans', 25)}
                      {chipStatus(h.resT, 'Residents', 5)}
                      {chipStatus(h.cov, 'L5 drone')}
                      {chipStatus(h.mr, 'L6 3D', h.os ?? undefined)}
                    </div>
                    <div className="text-xs text-[#929ba2]">
                      {pl(msgsAt(ev, t, h.id).length, 'report')} ·{' '}
                      {pl(h.dev.filter((d) => t >= d.t2).length, 'phone')} · Simulated
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
