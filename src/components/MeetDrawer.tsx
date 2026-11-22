import React, { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Check,
  Copy,
  ExternalLink,
  History,
  LogOut,
  PhoneOff,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import type {
  EventState,
  MeetAccessType,
  MeetConferenceSummary,
  MeetModerationMode,
  MeetSpaceItem,
} from '../types/sara';
import { GoogleSignInButton } from './GoogleSignInButton';
import { StatusChip } from './StatusChip';

interface PendingMeetMutation {
  kind: 'updateSettings' | 'endConference';
  space: MeetSpaceItem;
  nextAccessType?: MeetAccessType;
  nextModeration?: MeetModerationMode;
}

interface MeetDrawerProps {
  open: boolean;
  onClose: () => void;
  ev: EventState | null;
  activeBid: number | null;
  user: User | null;
  needsAuth: boolean;
  isSigningIn: boolean;
  isBusy: boolean;
  error: string | null;
  spaces: MeetSpaceItem[];
  conferences: MeetConferenceSummary[];
  onSignIn: () => void;
  onSignOut: () => void;
  onCreateSpace: (opts: {
    accessType: MeetAccessType;
    moderation: MeetModerationMode;
    buildingId: number | null;
    label: string;
  }) => Promise<void>;
  onLookupSpace: (codeOrUrl: string, buildingId: number | null) => Promise<void>;
  onRefreshSpace: (spaceName: string) => Promise<void>;
  onUpdateSpaceSettings: (
    spaceName: string,
    settings: { accessType: MeetAccessType; moderation: MeetModerationMode }
  ) => Promise<void>;
  onEndConference: (spaceName: string) => Promise<void>;
  onLoadConferences: () => Promise<void>;
  onRemoveSpaceFromList: (spaceName: string) => void;
}

export function MeetDrawer({
  open,
  onClose,
  ev,
  activeBid,
  user,
  needsAuth,
  isSigningIn,
  isBusy,
  error,
  spaces,
  conferences,
  onSignIn,
  onSignOut,
  onCreateSpace,
  onLookupSpace,
  onRefreshSpace,
  onUpdateSpaceSettings,
  onEndConference,
  onLoadConferences,
  onRemoveSpaceFromList,
}: MeetDrawerProps) {
  const [targetScope, setTargetScope] = useState<string>(
    activeBid != null ? String(activeBid) : 'event'
  );
  const [roomLabel, setRoomLabel] = useState('');
  const [accessType, setAccessType] = useState<MeetAccessType>('TRUSTED');
  const [moderation, setModeration] = useState<MeetModerationMode>('OFF');
  const [lookupInput, setLookupInput] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [editingSpaceName, setEditingSpaceName] = useState<string | null>(null);
  const [editAccess, setEditAccess] = useState<MeetAccessType>('TRUSTED');
  const [editModeration, setEditModeration] = useState<MeetModerationMode>('OFF');
  const [pendingMutation, setPendingMutation] = useState<PendingMeetMutation | null>(null);

  useEffect(() => {
    if (open) {
      setTargetScope(activeBid != null ? String(activeBid) : 'event');
      setPendingMutation(null);
      setEditingSpaceName(null);
    }
  }, [open, activeBid]);

  const selectedBuildingId = useMemo(() => {
    if (targetScope === 'event') return null;
    const id = Number(targetScope);
    return ev && ev.H[id] ? id : null;
  }, [targetScope, ev]);

  const defaultLabel = useMemo(() => {
    if (selectedBuildingId != null && ev?.city.bl[selectedBuildingId]) {
      return `${ev.city.bl[selectedBuildingId].addr} team briefing`;
    }
    if (ev) {
      return `${ev.loc.city} command briefing`;
    }
    return 'SARA command briefing';
  }, [selectedBuildingId, ev]);

  if (!open) return null;

  const handleCopy = async (uri: string, code: string) => {
    try {
      await navigator.clipboard.writeText(uri);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((prev) => (prev === code ? null : prev)), 2000);
    } catch {
      // Clipboard API may be unavailable in restricted contexts
    }
  };

  const handleConfirmMutation = async () => {
    if (!pendingMutation) return;
    const mutation = pendingMutation;
    setPendingMutation(null);
    if (
      mutation.kind === 'updateSettings' &&
      mutation.nextAccessType &&
      mutation.nextModeration
    ) {
      await onUpdateSpaceSettings(mutation.space.name, {
        accessType: mutation.nextAccessType,
        moderation: mutation.nextModeration,
      });
      setEditingSpaceName(null);
    } else if (mutation.kind === 'endConference') {
      await onEndConference(mutation.space.name);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Google Meet — Command briefings"
    >
      <div className="relative w-full max-w-lg h-full bg-[#15191c] border-l border-[#2c3338] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-[#2c3338] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Video className="w-5 h-5 text-[#45c4ea] shrink-0" />
            <div className="min-w-0">
              <h2 className="font-cond text-lg font-semibold text-[#e7eaec] leading-tight">
                Google Meet · Command briefings
              </h2>
              <p className="text-xs text-[#929ba2] truncate">
                Create, inspect, and manage live Google Meet rooms
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Google Meet panel"
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md bg-[#1b2024] border border-[#2c3338] text-[#929ba2] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Auth & Controls */}
        <div className="p-4 border-b border-[#2c3338] bg-[#111518] space-y-3">
          {needsAuth ? (
            <div className="space-y-2.5">
              <p className="text-xs text-[#929ba2] m-0 leading-relaxed">
                {user
                  ? 'Sign in again with Google to authorize Google Meet room creation and management.'
                  : 'Sign in with Google to create Google Meet briefing spaces, check live conferences, and adjust room access.'}
              </p>
              <GoogleSignInButton onClick={onSignIn} loading={isSigningIn} />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 bg-[#1b2024] border border-[#2c3338] rounded-md px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[#e7eaec] truncate">
                    {user?.displayName || user?.email || 'Google account connected'}
                  </div>
                  {user?.email && user?.displayName && (
                    <div className="text-[11px] text-[#929ba2] truncate">{user.email}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex items-center gap-1.5 min-h-[32px] px-2.5 rounded bg-[#232a2f] border border-[#2c3338] hover:border-[#46515a] text-xs text-[#e7eaec] cursor-pointer shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </button>
              </div>

              {/* Create Space Form */}
              <div className="bg-[#1b2024] border border-[#2c3338] rounded-lg p-3 space-y-2.5">
                <div className="text-xs font-semibold text-[#e7eaec]">New Google Meet room</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={roomLabel}
                    onChange={(e) => setRoomLabel(e.target.value)}
                    placeholder={defaultLabel}
                    aria-label="Briefing room label"
                    className="min-h-[36px] bg-[#15191c] border border-[#2c3338] rounded px-2.5 text-xs text-[#e7eaec] placeholder:text-[#929ba2]/60"
                  />
                  {ev ? (
                    <select
                      aria-label="Link room to event or building"
                      value={targetScope}
                      onChange={(e) => setTargetScope(e.target.value)}
                      className="min-h-[36px] bg-[#15191c] border border-[#2c3338] rounded px-2 text-xs text-[#e7eaec]"
                    >
                      <option value="event">Scope: Event ({ev.loc.city})</option>
                      {ev.hits.map((h) => (
                        <option key={h.id} value={String(h.id)}>
                          Building: {ev.city.bl[h.id].addr}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="min-h-[36px] px-2.5 rounded bg-[#15191c] border border-[#2c3338] flex items-center text-xs text-[#929ba2]">
                      Scope: General command
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Meeting access type"
                    value={accessType}
                    onChange={(e) => setAccessType(e.target.value as MeetAccessType)}
                    className="min-h-[36px] bg-[#15191c] border border-[#2c3338] rounded px-2 text-xs text-[#e7eaec]"
                  >
                    <option value="TRUSTED">Access: Trusted org</option>
                    <option value="OPEN">Access: Open link</option>
                    <option value="RESTRICTED">Access: Invited only</option>
                  </select>

                  <select
                    aria-label="Host moderation"
                    value={moderation}
                    onChange={(e) => setModeration(e.target.value as MeetModerationMode)}
                    className="min-h-[36px] bg-[#15191c] border border-[#2c3338] rounded px-2 text-xs text-[#e7eaec]"
                  >
                    <option value="OFF">Moderation: Off</option>
                    <option value="ON">Moderation: On</option>
                  </select>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      const labelToUse = roomLabel.trim() || defaultLabel;
                      void onCreateSpace({
                        accessType,
                        moderation,
                        buildingId: selectedBuildingId,
                        label: labelToUse,
                      }).then(() => setRoomLabel(''));
                    }}
                    className="ml-auto min-h-[36px] px-3.5 py-1.5 rounded-md bg-[#ff6a2b] text-[#160800] font-semibold text-xs hover:brightness-110 disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <Video className="w-3.5 h-3.5" />
                    {isBusy ? 'Working…' : 'Create Meet room'}
                  </button>
                </div>
              </div>

              {/* Lookup existing space */}
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!lookupInput.trim() || isBusy) return;
                  void onLookupSpace(lookupInput.trim(), selectedBuildingId).then(() =>
                    setLookupInput('')
                  );
                }}
              >
                <input
                  type="text"
                  value={lookupInput}
                  onChange={(e) => setLookupInput(e.target.value)}
                  placeholder="Look up Meet code or URL (e.g. abc-defg-hij)"
                  aria-label="Google Meet code or URL"
                  className="flex-1 min-h-[36px] bg-[#1b2024] border border-[#2c3338] rounded px-2.5 text-xs text-[#e7eaec] placeholder:text-[#929ba2]/60"
                />
                <button
                  type="submit"
                  disabled={!lookupInput.trim() || isBusy}
                  className="min-h-[36px] px-3 rounded bg-[#232a2f] border border-[#2c3338] hover:border-[#45c4ea] text-xs text-[#e7eaec] disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Search className="w-3.5 h-3.5 text-[#45c4ea]" />
                  Look up
                </button>
              </form>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-[#612723] bg-[#361614] px-3 py-2 text-xs text-[#ff9a8a]">
              {error}
            </div>
          )}
        </div>

        {/* Rooms & Conference History */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#e7eaec]">
                Briefing rooms ({spaces.length})
              </span>
              <StatusChip tone="ok">Google Meet API</StatusChip>
            </div>

            {spaces.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#2c3338] p-5 text-center space-y-1">
                <Video className="w-5 h-5 text-[#929ba2] mx-auto" />
                <div className="text-xs font-medium text-[#e7eaec]">No Meet rooms created yet</div>
                <p className="text-xs text-[#929ba2] m-0">
                  Create a briefing room above or look up an existing Meet code.
                </p>
              </div>
            ) : (
              spaces.map((sp) => {
                const isEditing = editingSpaceName === sp.name;
                return (
                  <div
                    key={sp.name}
                    className="bg-[#1b2024] border border-[#2c3338] rounded-lg p-3 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-[#e7eaec] truncate">
                          {sp.label}
                        </div>
                        <div className="font-mono-tab text-xs text-[#45c4ea] mt-0.5">
                          {sp.meetingCode}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
                        {sp.activeConferenceRecord && <StatusChip tone="ok">Live call</StatusChip>}
                        <StatusChip tone="neutral">{sp.accessType}</StatusChip>
                        {sp.moderation === 'ON' && <StatusChip tone="ld">Moderated</StatusChip>}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#929ba2]">
                      {sp.buildingAddr ? (
                        <StatusChip tone="ld">{sp.buildingAddr}</StatusChip>
                      ) : (
                        <StatusChip>Event-wide</StatusChip>
                      )}
                      <span>Created {new Date(sp.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    {/* Action Row */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {sp.meetingUri && (
                        <a
                          href={sp.meetingUri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[32px] px-3 rounded bg-[#ff6a2b] text-[#160800] font-semibold text-xs inline-flex items-center gap-1.5 hover:brightness-110"
                        >
                          Join Meet
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {sp.meetingUri && (
                        <button
                          type="button"
                          onClick={() => void handleCopy(sp.meetingUri!, sp.meetingCode)}
                          className="min-h-[32px] px-2.5 rounded bg-[#232a2f] border border-[#2c3338] hover:border-[#45c4ea] text-xs text-[#e7eaec] inline-flex items-center gap-1 cursor-pointer"
                        >
                          {copiedCode === sp.meetingCode ? (
                            <>
                              <Check className="w-3 h-3 text-[#9be5fa]" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              Copy link
                            </>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={needsAuth || isBusy}
                        title="Refresh live space status"
                        onClick={() => void onRefreshSpace(sp.name)}
                        className="min-h-[32px] px-2 rounded bg-[#232a2f] border border-[#2c3338] hover:border-[#45c4ea] text-xs text-[#e7eaec] disabled:opacity-50 cursor-pointer inline-flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={needsAuth || isBusy}
                        onClick={() => {
                          if (isEditing) {
                            setEditingSpaceName(null);
                          } else {
                            setEditingSpaceName(sp.name);
                            setEditAccess(sp.accessType);
                            setEditModeration(sp.moderation);
                          }
                        }}
                        className="min-h-[32px] px-2.5 rounded bg-[#232a2f] border border-[#2c3338] hover:border-[#45c4ea] text-xs text-[#e7eaec] disabled:opacity-50 cursor-pointer inline-flex items-center gap-1"
                      >
                        <Settings className="w-3 h-3" />
                        Settings
                      </button>
                      {sp.activeConferenceRecord && (
                        <button
                          type="button"
                          disabled={needsAuth || isBusy}
                          onClick={() =>
                            setPendingMutation({
                              kind: 'endConference',
                              space: sp,
                            })
                          }
                          className="min-h-[32px] px-2.5 rounded bg-[#361614] border border-[#612723] hover:border-[#ff4d2e] text-xs text-[#ff9a8a] disabled:opacity-50 cursor-pointer inline-flex items-center gap-1"
                        >
                          <PhoneOff className="w-3 h-3" />
                          End call
                        </button>
                      )}
                      <button
                        type="button"
                        title="Remove from local list (does not delete Meet space)"
                        aria-label={`Remove ${sp.label} from list`}
                        onClick={() => onRemoveSpaceFromList(sp.name)}
                        className="ml-auto min-h-[32px] min-w-[32px] flex items-center justify-center rounded bg-[#232a2f] border border-[#2c3338] hover:border-[#ff4d2e] text-[#929ba2] hover:text-[#ff9a8a] cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Settings Editor */}
                    {isEditing && (
                      <div className="pt-2.5 border-t border-[#2c3338] flex flex-wrap items-center gap-2">
                        <select
                          aria-label={`Update access for ${sp.meetingCode}`}
                          value={editAccess}
                          onChange={(e) => setEditAccess(e.target.value as MeetAccessType)}
                          className="min-h-[32px] bg-[#15191c] border border-[#2c3338] rounded px-2 text-xs text-[#e7eaec]"
                        >
                          <option value="TRUSTED">Trusted org</option>
                          <option value="OPEN">Open link</option>
                          <option value="RESTRICTED">Invited only</option>
                        </select>
                        <select
                          aria-label={`Update moderation for ${sp.meetingCode}`}
                          value={editModeration}
                          onChange={(e) => setEditModeration(e.target.value as MeetModerationMode)}
                          className="min-h-[32px] bg-[#15191c] border border-[#2c3338] rounded px-2 text-xs text-[#e7eaec]"
                        >
                          <option value="OFF">Moderation: Off</option>
                          <option value="ON">Moderation: On</option>
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            setPendingMutation({
                              kind: 'updateSettings',
                              space: sp,
                              nextAccessType: editAccess,
                              nextModeration: editModeration,
                            })
                          }
                          className="min-h-[32px] px-3 rounded bg-[#2d3a42] border border-[#45c4ea] text-xs font-medium text-white cursor-pointer"
                        >
                          Save settings
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingSpaceName(null)}
                          className="min-h-[32px] px-2.5 rounded bg-[#232a2f] border border-[#2c3338] text-xs text-[#929ba2] cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Conference History */}
          {!needsAuth && (
            <div className="pt-3 border-t border-[#2c3338] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#e7eaec] inline-flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-[#45c4ea]" />
                  Recent conference records
                </span>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void onLoadConferences()}
                  className="min-h-[30px] px-2.5 rounded bg-[#1b2024] border border-[#2c3338] hover:border-[#45c4ea] text-xs text-[#e7eaec] disabled:opacity-50 cursor-pointer"
                >
                  Load history
                </button>
              </div>

              {conferences.length > 0 ? (
                <div className="space-y-1.5">
                  {conferences.map((c) => (
                    <div
                      key={c.name}
                      className="bg-[#1b2024] border border-[#2c3338] rounded px-3 py-2 text-xs flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="font-mono-tab text-[#e7eaec] truncate">
                          {c.space.replace(/^spaces\//, '')}
                        </div>
                        <div className="text-[#929ba2] text-[11px]">
                          {c.startTime ? new Date(c.startTime).toLocaleString() : 'Unknown start'}
                          {c.endTime ? ' · ended' : ' · active'}
                        </div>
                      </div>
                      {c.participantCount != null && (
                        <StatusChip>{c.participantCount} participants</StatusChip>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#929ba2] m-0">
                  Click &ldquo;Load history&rdquo; to inspect recent Google Meet conference logs.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Explicit Confirmation Dialog for Mutating Meet Operations */}
        {pendingMutation && (
          <div
            className="absolute inset-0 z-20 bg-black/75 flex items-center justify-center p-4"
            role="alertdialog"
            aria-modal="true"
            aria-label="Confirm Google Meet action"
          >
            <div className="w-full max-w-sm bg-[#1b2024] border border-[#2c3338] rounded-lg p-4 space-y-3 shadow-2xl">
              <div className="font-cond text-base font-semibold text-[#e7eaec]">
                {pendingMutation.kind === 'endConference'
                  ? 'End active Google Meet call?'
                  : 'Update Google Meet room settings?'}
              </div>
              <p className="text-xs text-[#929ba2] leading-relaxed m-0">
                {pendingMutation.kind === 'endConference' ? (
                  <>
                    This will end the live conference in{' '}
                    <strong className="text-[#e7eaec]">{pendingMutation.space.label}</strong> (
                    <span className="font-mono-tab">{pendingMutation.space.meetingCode}</span>) and
                    disconnect all active participants.
                  </>
                ) : (
                  <>
                    Update room <strong className="text-[#e7eaec]">{pendingMutation.space.label}</strong>{' '}
                    (<span className="font-mono-tab">{pendingMutation.space.meetingCode}</span>) to
                    access <strong className="text-[#e7eaec]">{pendingMutation.nextAccessType}</strong>{' '}
                    and moderation{' '}
                    <strong className="text-[#e7eaec]">{pendingMutation.nextModeration}</strong>?
                  </>
                )}
              </p>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPendingMutation(null)}
                  className="min-h-[36px] px-3 rounded bg-[#232a2f] border border-[#2c3338] text-xs text-[#e7eaec] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void handleConfirmMutation()}
                  className={`min-h-[36px] px-3.5 rounded text-xs font-semibold cursor-pointer ${
                    pendingMutation.kind === 'endConference'
                      ? 'bg-[#ff4d2e] text-white'
                      : 'bg-[#ff6a2b] text-[#160800]'
                  }`}
                >
                  {pendingMutation.kind === 'endConference' ? 'Confirm end call' : 'Confirm update'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
