import React from 'react';
import { Building2, Compass, Map as MapIcon } from 'lucide-react';
import type { EventState, ViewRoute } from '../types/sara';

interface MobileNavBarProps {
  view: ViewRoute;
  ev: EventState | null;
  bid: number | null;
  onNavigate: (v: ViewRoute, bid?: number) => void;
}

export function MobileNavBar({ view, ev, bid, onNavigate }: MobileNavBarProps) {
  return (
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#0a0c0e]/95 backdrop-blur-md border-t border-[#2c3338] pb-safe"
    >
      <div className="grid grid-cols-3 h-14 items-center">
        <button
          type="button"
          onClick={() => onNavigate('command')}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
            view === 'command' ? 'text-[#45c4ea]' : 'text-[#929ba2]'
          }`}
        >
          <Compass className="w-5 h-5" />
          <span>Command</span>
        </button>

        <button
          type="button"
          disabled={!ev}
          onClick={() => ev && onNavigate('area')}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
            !ev
              ? 'text-[#929ba2]/30'
              : view === 'area'
                ? 'text-[#45c4ea]'
                : 'text-[#929ba2]'
          }`}
        >
          <MapIcon className="w-5 h-5" />
          <span>Area view</span>
        </button>

        <button
          type="button"
          disabled={bid == null}
          onClick={() => bid != null && onNavigate('building', bid)}
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
            bid == null
              ? 'text-[#929ba2]/30'
              : view === 'building'
                ? 'text-[#45c4ea]'
                : 'text-[#929ba2]'
          }`}
        >
          <Building2 className="w-5 h-5" />
          <span>Building</span>
        </button>
      </div>
    </nav>
  );
}
