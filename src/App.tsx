import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { EventState, SeverityKey, ViewRoute } from './types/sara';
import {
  addHit,
  buildDemoEvent,
  loc3,
  planOrbits,
  rebuildHitData,
} from './sim/engine';
import { TopBar } from './components/TopBar';
import { MobileNavBar } from './components/MobileNavBar';
import { CommandView } from './components/CommandView';
import { AreaView } from './components/AreaView';
import { BuildingView } from './components/BuildingView';

function parseHash(): { view: ViewRoute; bid: number | null } {
  const hs = window.location.hash.slice(1) || 'command';
  if (hs === 'area') return { view: 'area', bid: null };
  if (/^b-\d+$/.test(hs)) return { view: 'building', bid: Number(hs.slice(2)) };
  return { view: 'command', bid: null };
}

export default function App() {
  const [ev, setEv] = useState<EventState | null>(null);
  const [t, setT] = useState(0);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [view, setView] = useState<ViewRoute>(() => parseHash().view);
  const [bid, setBid] = useState<number | null>(() => parseHash().bid);
  const [, forceTick] = useState(0);

  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const evRef = useRef(ev);
  evRef.current = ev;

  // Sync URL hash navigation
  useEffect(() => {
    const onHash = () => {
      const parsed = parseHash();
      if (parsed.view === 'area' && !evRef.current) {
        setView('command');
        return;
      }
      if (parsed.view === 'building') {
        if (
          parsed.bid != null &&
          evRef.current &&
          evRef.current.H[parsed.bid] != null
        ) {
          setBid(parsed.bid);
          setView('building');
        } else {
          setView(evRef.current ? 'area' : 'command');
        }
        return;
      }
      setView(parsed.view);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Simulation time loop (dt in seconds * speed = simulated minutes)
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (evRef.current && runningRef.current) {
        acc += dt * speedRef.current;
        if (acc >= 0.25) {
          const delta = acc;
          acc = 0;
          setT((prev) => prev + delta);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const navigate = useCallback(
    (nextView: ViewRoute, nextBid?: number) => {
      if (nextView === 'area' && !ev) return;
      if (nextView === 'building') {
        const targetId = nextBid ?? bid;
        if (targetId == null || !ev || !ev.H[targetId]) return;
        setBid(targetId);
        setView('building');
        window.location.hash = `b-${targetId}`;
        return;
      }
      setView(nextView);
      window.location.hash = nextView;
    },
    [ev, bid]
  );

  const handleStartEvent = useCallback((newEv: EventState, goToArea: boolean) => {
    setEv(newEv);
    setT(0);
    setSpeed(5);
    setRunning(true);
    setBid(newEv.hits[0]?.id ?? null);
    if (goToArea) {
      setView('area');
      window.location.hash = 'area';
    }
  }, []);

  const handleLoadDemo = useCallback(() => {
    const demo = buildDemoEvent();
    handleStartEvent(demo, true);
  }, [handleStartEvent]);

  const mutateEv = useCallback((fn: (current: EventState) => void) => {
    setEv((prev) => {
      if (!prev) return prev;
      fn(prev);
      return { ...prev };
    });
    forceTick((n) => n + 1);
  }, []);

  const handleAddBuilding = useCallback(
    (id: number, sev: SeverityKey) => {
      if (!ev) return;
      mutateEv((cur) => {
        if (!cur.H[id]) {
          addHit(cur, id, sev, t);
          planOrbits(cur);
        }
      });
      setBid(id);
      setView('building');
      window.location.hash = `b-${id}`;
    },
    [ev, t, mutateEv]
  );

  const handleChangeSeverity = useCallback(
    (id: number, sev: SeverityKey) => {
      mutateEv((cur) => {
        const h = cur.H[id];
        if (h) rebuildHitData(cur, h, sev);
      });
    },
    [mutateEv]
  );

  const handleAssignTeam = useCallback(
    (id: number, team: string | null) => {
      mutateEv((cur) => {
        cur.team = { ...cur.team, [id]: team };
      });
    },
    [mutateEv]
  );

  const handleSendSms = useCallback(
    (buildingId: number, devIndex: number) => {
      mutateEv((cur) => {
        cur.sms = { ...cur.sms, [`${buildingId}-${devIndex}`]: t };
      });
    },
    [t, mutateEv]
  );

  const handleSendSmsAll = useCallback(() => {
    mutateEv((cur) => {
      const nextSms = { ...cur.sms };
      for (const h of cur.hits) {
        for (const d of h.dev) {
          const key = `${h.id}-${d.k}`;
          if (loc3(d, t) && nextSms[key] == null) {
            nextSms[key] = t;
          }
        }
      }
      cur.sms = nextSms;
    });
  }, [t, mutateEv]);

  const handleVerifyMsg = useCallback(
    (msgId: number | string) => {
      mutateEv((cur) => {
        cur.ver = { ...cur.ver, [msgId]: true };
      });
    },
    [mutateEv]
  );

  const handleRankBuilding = useCallback(
    (id: number) => {
      mutateEv((cur) => {
        if (!cur.priorityOrder.includes(id)) {
          cur.priorityOrder = [...cur.priorityOrder, id];
        }
      });
    },
    [mutateEv]
  );

  const handleUnrankBuilding = useCallback(
    (id: number) => {
      mutateEv((cur) => {
        cur.priorityOrder = cur.priorityOrder.filter((x) => x !== id);
      });
    },
    [mutateEv]
  );

  const handleMoveRank = useCallback(
    (id: number, dir: -1 | 1) => {
      mutateEv((cur) => {
        const idx = cur.priorityOrder.indexOf(id);
        if (idx === -1) return;
        const target = idx + dir;
        if (target < 0 || target >= cur.priorityOrder.length) return;
        const next = [...cur.priorityOrder];
        [next[idx], next[target]] = [next[target], next[idx]];
        cur.priorityOrder = next;
      });
    },
    [mutateEv]
  );

  const handleSetRankReason = useCallback(
    (id: number, reason: string) => {
      mutateEv((cur) => {
        cur.priorityReasons = { ...cur.priorityReasons, [id]: reason };
      });
    },
    [mutateEv]
  );

  const handleClearRanks = useCallback(() => {
    mutateEv((cur) => {
      cur.priorityOrder = [];
    });
  }, [mutateEv]);

  const activeView: ViewRoute =
    view === 'area' && ev
      ? 'area'
      : view === 'building' && ev && bid != null && ev.H[bid]
        ? 'building'
        : 'command';

  return (
    <div className="min-h-screen md:h-screen flex flex-col bg-[#0e1113] text-[#e7eaec] md:overflow-hidden">
      <TopBar
        view={activeView}
        ev={ev}
        bid={bid}
        t={t}
        running={running}
        speed={speed}
        onNavigate={navigate}
        onSelectBuilding={(id) => navigate('building', id)}
        onSetSpeed={(sp, run) => {
          setSpeed(sp);
          setRunning(run);
        }}
        onJumpTime={(delta) => setT((prev) => prev + delta)}
      />

      <main className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden">
        {activeView === 'command' && (
          <div className="h-full overflow-y-auto">
            <CommandView
              ev={ev}
              t={t}
              onStartEvent={handleStartEvent}
              onLoadDemo={handleLoadDemo}
              onOpenArea={() => navigate('area')}
              onOpenBuilding={(id) => navigate('building', id)}
            />
          </div>
        )}

        {activeView === 'area' && ev && (
          <div className="h-full overflow-y-auto lg:overflow-hidden">
            <AreaView
              ev={ev}
              t={t}
              onOpenBuilding={(id) => navigate('building', id)}
              onAddBuilding={handleAddBuilding}
              onAssignTeam={handleAssignTeam}
              onSendSms={handleSendSms}
              onSendSmsAll={handleSendSmsAll}
              onVerifyMsg={handleVerifyMsg}
              onRankBuilding={handleRankBuilding}
              onUnrankBuilding={handleUnrankBuilding}
              onMoveRank={handleMoveRank}
              onSetRankReason={handleSetRankReason}
              onClearRanks={handleClearRanks}
            />
          </div>
        )}

        {activeView === 'building' && ev && bid != null && (
          <div className="h-full overflow-y-auto">
            <BuildingView
              ev={ev}
              bid={bid}
              t={t}
              onBackToArea={() => navigate('area')}
              onOpenBuilding={(id) => navigate('building', id)}
              onChangeSeverity={handleChangeSeverity}
              onAssignTeam={handleAssignTeam}
              onSendSms={handleSendSms}
              onVerifyMsg={handleVerifyMsg}
              onRankBuilding={handleRankBuilding}
              onUnrankBuilding={handleUnrankBuilding}
              onSetRankReason={handleSetRankReason}
            />
          </div>
        )}
      </main>

      <MobileNavBar view={activeView} ev={ev} bid={bid} onNavigate={navigate} />
    </div>
  );
}
