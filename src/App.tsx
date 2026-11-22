import React, { useCallback, useEffect, useRef, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import type { User } from 'firebase/auth';
import type {
  EventState,
  MeetAccessType,
  MeetConferenceSummary,
  MeetModerationMode,
  MeetSpaceItem,
  PickedDriveFile,
  SeverityKey,
  ViewRoute,
} from './types/sara';
import {
  addHit,
  buildDemoEvent,
  loc3,
  planOrbits,
  rebuildHitData,
} from './sim/engine';
import { GOOGLE_MAPS_API_KEY } from './lib/mapsConfig';
import { openGooglePicker } from './lib/googlePicker';
import {
  createMeetSpace,
  endMeetActiveConference,
  getMeetSpace,
  listMeetConferenceRecords,
  updateMeetSpaceSettings,
} from './lib/googleMeet';
import {
  WorkspaceAuthExpiredError,
  fetchDriveFileMetadata,
  getAccessToken,
  googleSignIn,
  initAuth,
  logout,
  sanitizeExternalUrl,
} from './lib/googleWorkspace';
import { TopBar } from './components/TopBar';
import { MobileNavBar } from './components/MobileNavBar';
import { CommandView } from './components/CommandView';
import { AreaView } from './components/AreaView';
import { BuildingView } from './components/BuildingView';
import { DrivePickerDrawer } from './components/DrivePickerDrawer';
import { MeetDrawer } from './components/MeetDrawer';

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
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [driveNeedsAuth, setDriveNeedsAuth] = useState(true);
  const [driveSigningIn, setDriveSigningIn] = useState(false);
  const [drivePicking, setDrivePicking] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveFiles, setDriveFiles] = useState<PickedDriveFile[]>([]);
  const [driveDrawerOpen, setDriveDrawerOpen] = useState(false);
  const [meetSpaces, setMeetSpaces] = useState<MeetSpaceItem[]>([]);
  const [meetConferences, setMeetConferences] = useState<MeetConferenceSummary[]>([]);
  const [meetBusy, setMeetBusy] = useState(false);
  const [meetError, setMeetError] = useState<string | null>(null);
  const [meetDrawerOpen, setMeetDrawerOpen] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  useEffect(() => {
    return initAuth(
      (signedInUser) => {
        setDriveUser(signedInUser);
        setDriveNeedsAuth(false);
      },
      (maybeUser) => {
        setDriveUser(maybeUser);
        setDriveNeedsAuth(true);
      }
    );
  }, []);

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

  const handleGoogleSignIn = useCallback(async () => {
    setDriveSigningIn(true);
    setDriveError(null);
    try {
      const result = await googleSignIn();
      setDriveUser(result.user);
      setDriveNeedsAuth(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to complete Google Sign-In.';
      setDriveError(msg);
      setDriveNeedsAuth(true);
    } finally {
      setDriveSigningIn(false);
    }
  }, []);

  const handleGoogleSignOut = useCallback(async () => {
    setDriveError(null);
    await logout();
    setDriveUser(null);
    setDriveNeedsAuth(true);
  }, []);

  const handleOpenPicker = useCallback(
    async (targetBuildingId: number | null = null) => {
      const token = getAccessToken();
      if (!token) {
        setDriveNeedsAuth(true);
        setDriveDrawerOpen(true);
        return;
      }

      const buildingAddr =
        targetBuildingId != null && ev?.city.bl[targetBuildingId]
          ? ev.city.bl[targetBuildingId].addr
          : undefined;

      setDrivePicking(true);
      setDriveError(null);
      try {
        const selected = await openGooglePicker({
          accessToken: token,
          buildingId: targetBuildingId,
          buildingAddr,
        });
        if (!selected.length) return;

        // Enrich metadata from Drive API v3 for picked files
        const enriched = await Promise.all(
          selected.map(async (item) => {
            try {
              const meta = await fetchDriveFileMetadata(item.id, token);
              if (!meta) return item;
              return {
                ...item,
                name: meta.name || item.name,
                mimeType: meta.mimeType || item.mimeType,
                url: sanitizeExternalUrl(meta.webViewLink) || item.url,
                iconUrl: sanitizeExternalUrl(meta.iconLink) || item.iconUrl,
                sizeBytes: meta.size ? Number(meta.size) : item.sizeBytes,
                modifiedTime: meta.modifiedTime || item.modifiedTime,
                ownerName: meta.owners?.[0]?.displayName || item.ownerName,
              };
            } catch (metaErr: unknown) {
              if (metaErr instanceof WorkspaceAuthExpiredError) {
                throw metaErr;
              }
              return item;
            }
          })
        );

        setDriveFiles((prev) => {
          const next = [...prev];
          for (const f of enriched) {
            const existingIdx = next.findIndex(
              (x) => x.id === f.id && x.buildingId === f.buildingId
            );
            if (existingIdx >= 0) {
              next[existingIdx] = f;
            } else {
              next.unshift(f);
            }
          }
          return next;
        });
        setDriveDrawerOpen(true);
      } catch (err: unknown) {
        if (err instanceof WorkspaceAuthExpiredError) {
          setDriveNeedsAuth(true);
          setDriveDrawerOpen(true);
        }
        const msg = err instanceof Error ? err.message : 'Unable to open Google Picker.';
        setDriveError(msg);
      } finally {
        setDrivePicking(false);
      }
    },
    [ev]
  );

  const handleRemoveDriveFile = useCallback((fileId: string, buildingId: number | null) => {
    setDriveFiles((prev) =>
      prev.filter((f) => !(f.id === fileId && f.buildingId === buildingId))
    );
  }, []);

  const requireMeetToken = useCallback((): string | null => {
    const token = getAccessToken();
    if (!token) {
      setDriveNeedsAuth(true);
      setMeetDrawerOpen(true);
      return null;
    }
    return token;
  }, []);

  const handleMeetError = useCallback((err: unknown, fallback: string) => {
    if (err instanceof WorkspaceAuthExpiredError) {
      setDriveNeedsAuth(true);
    }
    setMeetError(err instanceof Error ? err.message : fallback);
  }, []);

  const handleCreateMeetSpace = useCallback(
    async (opts: {
      accessType: MeetAccessType;
      moderation: MeetModerationMode;
      buildingId: number | null;
      label: string;
    }) => {
      const token = requireMeetToken();
      if (!token) return;
      const buildingAddr =
        opts.buildingId != null && ev?.city.bl[opts.buildingId]
          ? ev.city.bl[opts.buildingId].addr
          : undefined;
      setMeetBusy(true);
      setMeetError(null);
      try {
        const space = await createMeetSpace(token, {
          ...opts,
          buildingAddr,
        });
        setMeetSpaces((prev) => [space, ...prev.filter((s) => s.name !== space.name)]);
      } catch (err: unknown) {
        handleMeetError(err, 'Unable to create Google Meet room.');
      } finally {
        setMeetBusy(false);
      }
    },
    [ev, requireMeetToken, handleMeetError]
  );

  const handleLookupMeetSpace = useCallback(
    async (codeOrUrl: string, buildingId: number | null) => {
      const token = requireMeetToken();
      if (!token) return;
      const buildingAddr =
        buildingId != null && ev?.city.bl[buildingId]
          ? ev.city.bl[buildingId].addr
          : undefined;
      setMeetBusy(true);
      setMeetError(null);
      try {
        const space = await getMeetSpace(token, codeOrUrl, {
          buildingId,
          buildingAddr,
        });
        setMeetSpaces((prev) => {
          const existing = prev.find((s) => s.name === space.name);
          if (existing) {
            return prev.map((s) =>
              s.name === space.name ? { ...space, label: existing.label } : s
            );
          }
          return [space, ...prev];
        });
      } catch (err: unknown) {
        handleMeetError(err, 'Unable to look up Google Meet room.');
      } finally {
        setMeetBusy(false);
      }
    },
    [ev, requireMeetToken, handleMeetError]
  );

  const handleRefreshMeetSpace = useCallback(
    async (spaceName: string) => {
      const token = requireMeetToken();
      if (!token) return;
      setMeetBusy(true);
      setMeetError(null);
      try {
        const existing = meetSpaces.find((s) => s.name === spaceName);
        const updated = await getMeetSpace(token, spaceName, {
          buildingId: existing?.buildingId ?? null,
          buildingAddr: existing?.buildingAddr,
          label: existing?.label,
          createdAt: existing?.createdAt,
        });
        setMeetSpaces((prev) => prev.map((s) => (s.name === spaceName ? updated : s)));
      } catch (err: unknown) {
        handleMeetError(err, 'Unable to refresh Google Meet room.');
      } finally {
        setMeetBusy(false);
      }
    },
    [meetSpaces, requireMeetToken, handleMeetError]
  );

  const handleUpdateMeetSpaceSettings = useCallback(
    async (
      spaceName: string,
      settings: { accessType: MeetAccessType; moderation: MeetModerationMode }
    ) => {
      const token = requireMeetToken();
      if (!token) return;
      setMeetBusy(true);
      setMeetError(null);
      try {
        await updateMeetSpaceSettings(token, spaceName, settings);
        setMeetSpaces((prev) =>
          prev.map((s) =>
            s.name === spaceName
              ? { ...s, accessType: settings.accessType, moderation: settings.moderation }
              : s
          )
        );
      } catch (err: unknown) {
        handleMeetError(err, 'Unable to update Google Meet settings.');
      } finally {
        setMeetBusy(false);
      }
    },
    [requireMeetToken, handleMeetError]
  );

  const handleEndMeetConference = useCallback(
    async (spaceName: string) => {
      const token = requireMeetToken();
      if (!token) return;
      setMeetBusy(true);
      setMeetError(null);
      try {
        await endMeetActiveConference(token, spaceName);
        setMeetSpaces((prev) =>
          prev.map((s) =>
            s.name === spaceName ? { ...s, activeConferenceRecord: undefined } : s
          )
        );
      } catch (err: unknown) {
        handleMeetError(err, 'Unable to end active Google Meet call.');
      } finally {
        setMeetBusy(false);
      }
    },
    [requireMeetToken, handleMeetError]
  );

  const handleLoadMeetConferences = useCallback(async () => {
    const token = requireMeetToken();
    if (!token) return;
    setMeetBusy(true);
    setMeetError(null);
    try {
      const list = await listMeetConferenceRecords(token, 8);
      setMeetConferences(list);
    } catch (err: unknown) {
      handleMeetError(err, 'Unable to load Google Meet conference history.');
    } finally {
      setMeetBusy(false);
    }
  }, [requireMeetToken, handleMeetError]);

  const handleRemoveMeetSpaceFromList = useCallback((spaceName: string) => {
    setMeetSpaces((prev) => prev.filter((s) => s.name !== spaceName));
  }, []);

  const activeView: ViewRoute =
    view === 'area' && ev
      ? 'area'
      : view === 'building' && ev && bid != null && ev.H[bid]
        ? 'building'
        : 'command';

  const content = (
    <div className="min-h-screen md:h-screen flex flex-col bg-[#0e1113] text-[#e7eaec] md:overflow-hidden">
      {quotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      <TopBar
        view={activeView}
        ev={ev}
        bid={bid}
        t={t}
        running={running}
        speed={speed}
        driveConnected={!driveNeedsAuth}
        driveFileCount={driveFiles.length}
        meetCount={meetSpaces.length}
        onOpenDrivePicker={() => setDriveDrawerOpen(true)}
        onOpenMeet={() => setMeetDrawerOpen(true)}
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
              driveNeedsAuth={driveNeedsAuth}
              driveSigningIn={driveSigningIn}
              drivePicking={drivePicking}
              driveFiles={driveFiles}
              meetSpaces={meetSpaces}
              onGoogleSignIn={() => void handleGoogleSignIn()}
              onOpenPicker={(buildingId = null) => void handleOpenPicker(buildingId)}
              onOpenDriveDrawer={() => setDriveDrawerOpen(true)}
              onOpenMeetDrawer={() => setMeetDrawerOpen(true)}
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
              driveNeedsAuth={driveNeedsAuth}
              driveSigningIn={driveSigningIn}
              drivePicking={drivePicking}
              driveFiles={driveFiles}
              meetSpaces={meetSpaces}
              onGoogleSignIn={() => void handleGoogleSignIn()}
              onOpenPicker={(buildingId = null) => void handleOpenPicker(buildingId)}
              onOpenDriveDrawer={() => setDriveDrawerOpen(true)}
              onOpenMeetDrawer={() => setMeetDrawerOpen(true)}
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
              driveNeedsAuth={driveNeedsAuth}
              driveSigningIn={driveSigningIn}
              drivePicking={drivePicking}
              driveFiles={driveFiles}
              meetSpaces={meetSpaces}
              onGoogleSignIn={() => void handleGoogleSignIn()}
              onOpenPicker={(buildingId) => void handleOpenPicker(buildingId)}
              onOpenDriveDrawer={() => setDriveDrawerOpen(true)}
              onOpenMeetDrawer={() => setMeetDrawerOpen(true)}
              onBackToArea={() => navigate('area')}
              onOpenBuilding={(id) => navigate('building', id)}
              onChangeSeverity={handleChangeSeverity}
              onAssignTeam={handleAssignTeam}
              onSendSms={handleSendSms}
              onVerifyMsg={handleVerifyMsg}
              onRankBuilding={handleRankBuilding}
              onUnrankBuilding={handleUnrankBuilding}
              onSetRankReason={handleSetRankReason}
              onConnectStarlink={() => setT((prev) => Math.max(prev, 26))}
            />
          </div>
        )}
      </main>

      <MobileNavBar view={activeView} ev={ev} bid={bid} onNavigate={navigate} />

      <DrivePickerDrawer
        open={driveDrawerOpen}
        onClose={() => setDriveDrawerOpen(false)}
        ev={ev}
        activeBid={activeView === 'building' ? bid : null}
        user={driveUser}
        needsAuth={driveNeedsAuth}
        isSigningIn={driveSigningIn}
        isPicking={drivePicking}
        authError={driveError}
        files={driveFiles}
        onSignIn={() => void handleGoogleSignIn()}
        onSignOut={() => void handleGoogleSignOut()}
        onPickFiles={(targetBuildingId) => void handleOpenPicker(targetBuildingId)}
        onRemoveFile={handleRemoveDriveFile}
      />

      <MeetDrawer
        open={meetDrawerOpen}
        onClose={() => setMeetDrawerOpen(false)}
        ev={ev}
        activeBid={activeView === 'building' ? bid : null}
        user={driveUser}
        needsAuth={driveNeedsAuth}
        isSigningIn={driveSigningIn}
        isBusy={meetBusy}
        error={meetError}
        spaces={meetSpaces}
        conferences={meetConferences}
        onSignIn={() => void handleGoogleSignIn()}
        onSignOut={() => void handleGoogleSignOut()}
        onCreateSpace={handleCreateMeetSpace}
        onLookupSpace={handleLookupMeetSpace}
        onRefreshSpace={handleRefreshMeetSpace}
        onUpdateSpaceSettings={handleUpdateMeetSpaceSettings}
        onEndConference={handleEndMeetConference}
        onLoadConferences={handleLoadMeetConferences}
        onRemoveSpaceFromList={handleRemoveMeetSpaceFromList}
      />
    </div>
  );

  if (!GOOGLE_MAPS_API_KEY) {
    return content;
  }

  return (
    <APIProvider
      apiKey={GOOGLE_MAPS_API_KEY}
      language="en"
      region="IL"
      libraries={['marker', 'streetView', 'places']}
    >
      {content}
    </APIProvider>
  );
}
