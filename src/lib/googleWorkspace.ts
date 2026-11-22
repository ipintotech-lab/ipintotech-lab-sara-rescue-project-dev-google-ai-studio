import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  type User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/meetings.space.settings',
] as const;

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

// In-memory access token cache (never persisted to localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export function initAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: (user: User | null) => void
): () => void {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user && cachedAccessToken) {
      onAuthSuccess?.(user, cachedAccessToken);
    } else if (!isSigningIn) {
      if (!user) {
        cachedAccessToken = null;
      }
      onAuthFailure?.(user);
    }
  });
}

export async function googleSignIn(): Promise<{ user: User; accessToken: string }> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google sign-in completed, but no Workspace OAuth access token was returned.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getAccessToken(): string | null {
  return cachedAccessToken;
}

export function clearAccessToken(): void {
  cachedAccessToken = null;
}

export async function logout(): Promise<void> {
  cachedAccessToken = null;
  await auth.signOut();
}

export function sanitizeExternalUrl(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export interface DriveFileMetadata {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  iconLink?: string;
  owners?: { displayName?: string }[];
}

export class WorkspaceAuthExpiredError extends Error {
  constructor(message = 'Google Workspace session expired or needs updated permissions. Please sign in again.') {
    super(message);
    this.name = 'WorkspaceAuthExpiredError';
  }
}

export const DriveAuthExpiredError = WorkspaceAuthExpiredError;

export function handleWorkspaceAuthError(status: number, bodyText: string): void {
  if (
    status === 401 ||
    (status === 403 &&
      (bodyText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
        bodyText.includes('insufficient authentication scopes') ||
        bodyText.includes('Insufficient Permission')))
  ) {
    cachedAccessToken = null;
    throw new WorkspaceAuthExpiredError();
  }
}

export async function fetchDriveFileMetadata(
  fileId: string,
  accessToken: string
): Promise<DriveFileMetadata | null> {
  if (!fileId || !accessToken) return null;
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId
  )}?fields=id,name,mimeType,size,modifiedTime,webViewLink,iconLink,owners(displayName)&supportsAllDrives=true`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401 || res.status === 403) {
    const txt = await res.text();
    handleWorkspaceAuthError(res.status, txt);
    return null;
  }

  if (!res.ok) {
    return null;
  }

  return (await res.json()) as DriveFileMetadata;
}
