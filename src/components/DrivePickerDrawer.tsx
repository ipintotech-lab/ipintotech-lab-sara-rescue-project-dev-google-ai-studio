import React, { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { ExternalLink, FileText, FolderOpen, LogOut, Trash2, X } from 'lucide-react';
import type { EventState, PickedDriveFile } from '../types/sara';
import { GoogleSignInButton } from './GoogleSignInButton';
import { StatusChip } from './StatusChip';

function formatBytes(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortMime(mime: string): string {
  if (mime === 'application/vnd.google-apps.document') return 'Google Doc';
  if (mime === 'application/vnd.google-apps.spreadsheet') return 'Google Sheet';
  if (mime === 'application/vnd.google-apps.presentation') return 'Google Slides';
  if (mime === 'application/pdf') return 'PDF';
  if (mime.startsWith('image/')) return mime.replace('image/', '').toUpperCase();
  const parts = mime.split('/');
  return parts[parts.length - 1] || 'File';
}

interface DrivePickerDrawerProps {
  open: boolean;
  onClose: () => void;
  ev: EventState | null;
  activeBid: number | null;
  user: User | null;
  needsAuth: boolean;
  isSigningIn: boolean;
  isPicking: boolean;
  authError: string | null;
  files: PickedDriveFile[];
  onSignIn: () => void;
  onSignOut: () => void;
  onPickFiles: (targetBuildingId: number | null) => void;
  onRemoveFile: (fileId: string, buildingId: number | null) => void;
}

export function DrivePickerDrawer({
  open,
  onClose,
  ev,
  activeBid,
  user,
  needsAuth,
  isSigningIn,
  isPicking,
  authError,
  files,
  onSignIn,
  onSignOut,
  onPickFiles,
  onRemoveFile,
}: DrivePickerDrawerProps) {
  const [targetScope, setTargetScope] = useState<string>(
    activeBid != null ? String(activeBid) : 'event'
  );
  const [filterScope, setFilterScope] = useState<'all' | 'event' | 'current'>('all');

  useEffect(() => {
    if (open) {
      setTargetScope(activeBid != null ? String(activeBid) : 'event');
    }
  }, [open, activeBid]);

  const selectedBuildingId = useMemo(() => {
    if (targetScope === 'event') return null;
    const id = Number(targetScope);
    return ev && ev.H[id] ? id : null;
  }, [targetScope, ev]);

  const visibleFiles = useMemo(() => {
    if (filterScope === 'event') return files.filter((f) => f.buildingId == null);
    if (filterScope === 'current' && activeBid != null) {
      return files.filter((f) => f.buildingId === activeBid);
    }
    return files;
  }, [files, filterScope, activeBid]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Google Picker — Drive files"
    >
      <div className="w-full max-w-lg h-full bg-[#15191c] border-l border-[#2c3338] flex flex-col shadow-2xl">
        {/* Drawer Header */}
        <div className="px-4 py-3.5 border-b border-[#2c3338] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FolderOpen className="w-5 h-5 text-[#45c4ea] shrink-0" />
            <div className="min-w-0">
              <h2 className="font-cond text-lg font-semibold text-[#e7eaec] leading-tight">
                Google Picker · Drive files
              </h2>
              <p className="text-xs text-[#929ba2] truncate">
                Attach plans, PDFs, imagery, or briefs from Google Drive
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Google Picker panel"
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md bg-[#1b2024] border border-[#2c3338] text-[#929ba2] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Auth & Picker Action Bar */}
        <div className="p-4 border-b border-[#2c3338] bg-[#111518] space-y-3">
          {needsAuth ? (
            <div className="space-y-2.5">
              <div className="text-xs text-[#929ba2] leading-relaxed">
                {user
                  ? 'Your Google Drive session needs a fresh sign-in to launch Google Picker.'
                  : 'Sign in with Google to browse and attach files from your Google Drive using Google Picker.'}
              </div>
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

              <div className="flex flex-wrap items-center gap-2">
                {ev && (
                  <select
                    aria-label="Target event or building for picked files"
                    value={targetScope}
                    onChange={(e) => setTargetScope(e.target.value)}
                    className="flex-1 min-w-[160px] min-h-[40px] bg-[#1b2024] border border-[#2c3338] rounded-md px-2.5 text-xs text-[#e7eaec]"
                  >
                    <option value="event">Attach to: Event ({ev.loc.city})</option>
                    {ev.hits.map((h) => (
                      <option key={h.id} value={String(h.id)}>
                        Attach to: {ev.city.bl[h.id].addr}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  type="button"
                  disabled={isPicking}
                  onClick={() => onPickFiles(selectedBuildingId)}
                  className="min-h-[40px] px-4 py-2 rounded-md bg-[#ff6a2b] text-[#160800] font-semibold text-xs md:text-sm hover:brightness-110 disabled:opacity-50 cursor-pointer inline-flex items-center gap-2"
                >
                  <FolderOpen className="w-4 h-4" />
                  {isPicking ? 'Opening Picker…' : 'Open Google Picker'}
                </button>
              </div>
            </div>
          )}

          {authError && (
            <div className="rounded-md border border-[#612723] bg-[#361614] px-3 py-2 text-xs text-[#ff9a8a]">
              {authError}
            </div>
          )}
        </div>

        {/* Attached Files List */}
        <div className="px-4 py-2.5 border-b border-[#2c3338] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[#e7eaec]">
              Attached files ({visibleFiles.length})
            </span>
            <StatusChip tone="ok">Google Drive</StatusChip>
          </div>
          {ev && (
            <div className="inline-flex border border-[#2c3338] rounded overflow-hidden bg-[#1b2024] text-[11px]">
              <button
                type="button"
                onClick={() => setFilterScope('all')}
                className={`px-2 py-1 cursor-pointer border-r border-[#2c3338] ${
                  filterScope === 'all' ? 'bg-[#2d3a42] text-white' : 'text-[#929ba2]'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilterScope('event')}
                className={`px-2 py-1 cursor-pointer ${
                  activeBid != null ? 'border-r border-[#2c3338]' : ''
                } ${filterScope === 'event' ? 'bg-[#2d3a42] text-white' : 'text-[#929ba2]'}`}
              >
                Event
              </button>
              {activeBid != null && ev.city.bl[activeBid] && (
                <button
                  type="button"
                  onClick={() => setFilterScope('current')}
                  className={`px-2 py-1 cursor-pointer truncate max-w-[110px] ${
                    filterScope === 'current' ? 'bg-[#2d3a42] text-white' : 'text-[#929ba2]'
                  }`}
                >
                  {ev.city.bl[activeBid].addr}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {visibleFiles.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#2c3338] p-6 text-center space-y-1.5">
              <FileText className="w-6 h-6 text-[#929ba2] mx-auto" />
              <div className="text-sm font-medium text-[#e7eaec]">No Drive files attached yet</div>
              <p className="text-xs text-[#929ba2] max-w-xs mx-auto">
                Use Google Picker to select architectural plans, reports, spreadsheets, or aerial images
                from your Google Drive.
              </p>
            </div>
          ) : (
            visibleFiles.map((file) => (
              <div
                key={`${file.id}-${file.buildingId ?? 'ev'}`}
                className="bg-[#1b2024] border border-[#2c3338] rounded-lg p-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    {file.iconUrl ? (
                      <img src={file.iconUrl} alt="" className="w-4 h-4 shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-[#45c4ea] shrink-0" />
                    )}
                    <span className="font-medium text-sm text-[#e7eaec] truncate">
                      {file.name}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#929ba2]">
                    <StatusChip>{shortMime(file.mimeType)}</StatusChip>
                    {file.buildingAddr ? (
                      <StatusChip tone="ld">{file.buildingAddr}</StatusChip>
                    ) : (
                      <StatusChip>Event-wide</StatusChip>
                    )}
                    {file.sizeBytes != null && <span>{formatBytes(file.sizeBytes)}</span>}
                    {file.ownerName && <span>· {file.ownerName}</span>}
                  </div>
                  {file.modifiedTime && (
                    <div className="text-[11px] text-[#929ba2]">
                      Modified {new Date(file.modifiedTime).toLocaleDateString()}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {file.url && (
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open in Google Drive"
                      className="min-h-[32px] px-2.5 rounded bg-[#232a2f] border border-[#2c3338] hover:border-[#45c4ea] text-xs text-[#45c4ea] inline-flex items-center gap-1"
                    >
                      Open
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  <button
                    type="button"
                    title="Unlink from SARA view (your Google Drive file stays untouched)"
                    aria-label={`Unlink ${file.name} from SARA view`}
                    onClick={() => onRemoveFile(file.id, file.buildingId)}
                    className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded bg-[#232a2f] border border-[#2c3338] hover:border-[#ff4d2e] text-[#929ba2] hover:text-[#ff9a8a] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-[#2c3338] bg-[#111518] text-[11px] text-[#929ba2]">
          Removing a file only unlinks it from this SARA C2 demo session; Drive files are never modified or deleted.
        </div>
      </div>
    </div>
  );
}
