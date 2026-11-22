import React, { useState } from 'react';
import { FolderOpen, Pause, Play, Radio, SlidersHorizontal, Video } from 'lucide-react';
import type { EventState, ViewRoute } from '../types/sara';
import { clockStr, fT, orderedHits } from '../sim/engine';

interface TopBarProps {
  view: ViewRoute;
  ev: EventState | null;
  bid: number | null;
  t: number;
  running: boolean;
  speed: number;
  driveConnected: boolean;
  driveFileCount: number;
  meetCount: number;
  onOpenDrivePicker: () => void;
  onOpenMeet: () => void;
  onNavigate: (v: ViewRoute, bid?: number) => void;
  onSelectBuilding: (id: number) => void;
  onSetSpeed: (speed: number, running: boolean) => void;
  onJumpTime: (deltaMin: number) => void;
}

export function TopBar({
  view,
  ev,
  bid,
  t,
  running,
  speed,
  driveConnected,
  driveFileCount,
  meetCount,
  onOpenDrivePicker,
  onOpenMeet,
  onNavigate,
  onSelectBuilding,
  onSetSpeed,
  onJumpTime,
}: TopBarProps) {
  const [mobileSimOpen, setMobileSimOpen] = useState(false);
  const starlinkOn = t >= 25;
  const ordered = ev ? orderedHits(ev) : [];

  return (
    <>
      {/* Desktop & Mobile Top Command Bar */}
      <header className="sticky top-0 z-30 bg-[#0a0c0e]/95 backdrop-blur-md border-b border-[#2c3338] px-3 md:px-4 py-2">
        <div className="flex items-center justify-between gap-3 md:gap-6">
          {/* Zone 1: Brand */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('command')}
              className="flex items-center gap-2 font-cond font-bold text-lg md:text-xl tracking-wide text-[#e7eaec] whitespace-nowrap shrink-0 cursor-pointer hover:text-white"
            >
              <span
                className="w-3 h-3 rounded-full bg-[#ff6a2b] shrink-0"
                style={{ boxShadow: '0 0 0 3px rgba(255,106,43,0.2)' }}
                aria-hidden="true"
              />
              SARA
            </button>

            {ev && (
              <span className="hidden lg:inline-block text-xs font-medium text-[#e7eaec] truncate max-w-[180px]">
                {ev.loc.city} · {ev.type}
              </span>
            )}
          </div>

          {/* Zone 2: Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => onNavigate('command')}
              className={`py-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors border-b-2 ${
                view === 'command'
                  ? 'text-white border-[#45c4ea]'
                  : 'text-[#929ba2] border-transparent hover:text-[#e7eaec]'
              }`}
            >
              Command
            </button>
            <button
              type="button"
              disabled={!ev}
              onClick={() => ev && onNavigate('area')}
              className={`py-1.5 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                !ev
                  ? 'text-[#929ba2]/35 border-transparent cursor-not-allowed'
                  : view === 'area'
                    ? 'text-white border-[#45c4ea] cursor-pointer'
                    : 'text-[#929ba2] border-transparent hover:text-[#e7eaec] cursor-pointer'
              }`}
            >
              Area view
            </button>
            <button
              type="button"
              disabled={bid == null}
              onClick={() => bid != null && onNavigate('building', bid)}
              className={`py-1.5 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                bid == null
                  ? 'text-[#929ba2]/35 border-transparent cursor-not-allowed'
                  : view === 'building'
                    ? 'text-white border-[#45c4ea] cursor-pointer'
                    : 'text-[#929ba2] border-transparent hover:text-[#e7eaec] cursor-pointer'
              }`}
            >
              Building file
            </button>

            {ev && (
              <select
                aria-label="Open building file"
                value={view === 'building' && bid != null ? String(bid) : ''}
                onChange={(e) => {
                  if (e.target.value !== '') onSelectBuilding(Number(e.target.value));
                }}
                className="bg-[#1b2024] border border-[#2c3338] rounded-md px-2.5 py-1 text-xs text-[#e7eaec] max-w-[190px] focus-visible:outline-2 focus-visible:outline-[#45c4ea]"
              >
                <option value="">Jump to building…</option>
                {ordered.map((h) => (
                  <option key={h.id} value={h.id}>
                    {ev.city.bl[h.id].addr}
                  </option>
                ))}
              </select>
            )}
          </nav>

          {/* Zone 3: Clock, Simulation Controls & Field Kit / Starlink State */}
          <div className="flex items-center gap-2 md:gap-3 shrink-0 ml-auto">
            {ev ? (
              <>
                <div className="text-right leading-tight">
                  <div className="font-cond font-semibold text-base md:text-lg text-[#e7eaec] tabular-nums whitespace-nowrap">
                    {fT(t)}
                    <span className="hidden sm:inline font-sans font-normal text-xs text-[#929ba2] ml-1.5">
                      {clockStr(ev, t)}
                    </span>
                  </div>
                </div>

                {/* Desktop inline sim speed controls */}
                <div className="hidden sm:inline-flex border border-[#2c3338] rounded-md overflow-hidden bg-[#1b2024]">
                  <button
                    type="button"
                    title={running ? 'Pause simulation' : 'Pause'}
                    onClick={() => onSetSpeed(speed, false)}
                    className={`px-2.5 py-1.5 text-xs border-r border-[#2c3338] cursor-pointer whitespace-nowrap ${
                      !running
                        ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                        : 'text-[#929ba2] hover:text-white'
                    }`}
                  >
                    ❚❚
                  </button>
                  {[1, 5, 20].map((sp) => (
                    <button
                      key={sp}
                      type="button"
                      onClick={() => onSetSpeed(sp, true)}
                      className={`px-2.5 py-1.5 text-xs border-r border-[#2c3338] cursor-pointer whitespace-nowrap ${
                        running && speed === sp
                          ? 'bg-[#2d3a42] text-white shadow-[inset_0_-2px_0_#45c4ea]'
                          : 'text-[#929ba2] hover:text-white'
                      }`}
                    >
                      {sp}×
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => onJumpTime(15)}
                    className="px-2.5 py-1.5 text-xs border-r border-[#2c3338] text-[#e7eaec] hover:bg-[#232a2f] cursor-pointer whitespace-nowrap"
                  >
                    +15m
                  </button>
                  <button
                    type="button"
                    onClick={() => onJumpTime(60)}
                    className="px-2.5 py-1.5 text-xs text-[#e7eaec] hover:bg-[#232a2f] cursor-pointer whitespace-nowrap"
                  >
                    +1h
                  </button>
                </div>

                {/* Mobile quick play/pause + time drawer button */}
                <div className="flex sm:hidden items-center gap-1">
                  <button
                    type="button"
                    aria-label={running ? 'Pause simulation' : 'Play simulation'}
                    onClick={() => onSetSpeed(speed || 5, !running)}
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md bg-[#1b2024] border border-[#2c3338] text-[#e7eaec]"
                  >
                    {running ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    aria-label="Simulation speed controls"
                    onClick={() => setMobileSimOpen((v) => !v)}
                    className={`min-h-[36px] px-2 flex items-center gap-1 rounded-md border text-xs ${
                      mobileSimOpen
                        ? 'bg-[#2d3a42] border-[#45c4ea] text-white'
                        : 'bg-[#1b2024] border-[#2c3338] text-[#929ba2]'
                    }`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>{running ? `${speed}×` : '0×'}</span>
                  </button>
                </div>

                {/* Field kit / Starlink status */}
                <div className="hidden md:flex items-center gap-2 text-xs text-[#929ba2] whitespace-nowrap">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      starlinkOn ? 'bg-[#45c4ea]' : 'bg-[#ff6a2b]'
                    }`}
                    aria-hidden="true"
                  />
                  <span>{starlinkOn ? 'Starlink · synced' : 'Offline · field kit only'}</span>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-xs text-[#929ba2] whitespace-nowrap">
                <Radio className="w-3.5 h-3.5 text-[#929ba2]" />
                <span className="hidden sm:inline">Field kit · Demo</span>
              </div>
            )}

            <button
              type="button"
              onClick={onOpenDrivePicker}
              className="inline-flex items-center gap-1.5 min-h-[34px] px-2.5 py-1 rounded-md bg-[#1b2024] border border-[#2c3338] hover:border-[#45c4ea] text-xs font-medium text-[#e7eaec] cursor-pointer whitespace-nowrap"
              title="Open Google Picker for Google Drive files"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  driveConnected ? 'bg-[#34a853]' : 'bg-[#929ba2]'
                }`}
                aria-hidden="true"
              />
              <FolderOpen className="w-3.5 h-3.5 text-[#45c4ea]" />
              <span className="hidden sm:inline">Drive Picker</span>
              {driveFileCount > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-[#10303a] text-[#9be5fa] text-[10.5px] font-semibold tabular-nums">
                  {driveFileCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onOpenMeet}
              className="inline-flex items-center gap-1.5 min-h-[34px] px-2.5 py-1 rounded-md bg-[#1b2024] border border-[#2c3338] hover:border-[#45c4ea] text-xs font-medium text-[#e7eaec] cursor-pointer whitespace-nowrap"
              title="Open Google Meet briefings"
            >
              <Video className="w-3.5 h-3.5 text-[#45c4ea]" />
              <span className="hidden sm:inline">Meet</span>
              {meetCount > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-[#10303a] text-[#9be5fa] text-[10.5px] font-semibold tabular-nums">
                  {meetCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Mobile expandable simulation speed bar */}
        {ev && mobileSimOpen && (
          <div className="sm:hidden mt-2 pt-2 border-t border-[#2c3338] flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {[1, 5, 20].map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => onSetSpeed(sp, true)}
                  className={`min-h-[36px] px-3 rounded-md text-xs border ${
                    running && speed === sp
                      ? 'bg-[#2d3a42] border-[#45c4ea] text-white'
                      : 'bg-[#1b2024] border-[#2c3338] text-[#929ba2]'
                  }`}
                >
                  {sp}×
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onJumpTime(15)}
                className="min-h-[36px] px-2.5 rounded-md text-xs bg-[#1b2024] border border-[#2c3338] text-[#e7eaec]"
              >
                +15m
              </button>
              <button
                type="button"
                onClick={() => onJumpTime(60)}
                className="min-h-[36px] px-2.5 rounded-md text-xs bg-[#1b2024] border border-[#2c3338] text-[#e7eaec]"
              >
                +1h
              </button>
            </div>
            <span className="text-[11px] text-[#929ba2] whitespace-nowrap">
              {starlinkOn ? 'Starlink' : 'Offline'}
            </span>
          </div>
        )}
      </header>
    </>
  );
}
