import type {
  MeetAccessType,
  MeetConferenceSummary,
  MeetModerationMode,
  MeetSpaceItem,
} from '../types/sara';
import { handleWorkspaceAuthError, sanitizeExternalUrl } from './googleWorkspace';

interface RawMeetSpace {
  name?: string;
  meetingUri?: string;
  meetingCode?: string;
  config?: {
    accessType?: string;
    moderation?: string;
  };
  activeConference?: {
    conferenceRecord?: string;
  };
}

interface RawConferenceRecord {
  name?: string;
  startTime?: string;
  endTime?: string;
  space?: string;
}

function normalizeSpaceResourceName(input: string): string {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/meet\.google\.com\/([a-z0-9-]+)/i);
  if (urlMatch) {
    return `spaces/${urlMatch[1]}`;
  }
  const clean = trimmed.replace(/^\/+/, '');
  if (clean.startsWith('spaces/')) {
    const id = clean.slice('spaces/'.length);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error('Invalid Google Meet space identifier.');
    }
    return `spaces/${id}`;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(clean)) {
    throw new Error('Enter a valid Google Meet code (e.g. abc-defg-hij) or Meet link.');
  }
  return `spaces/${clean}`;
}

function toAccessType(v?: string): MeetAccessType {
  if (v === 'OPEN' || v === 'TRUSTED' || v === 'RESTRICTED') return v;
  return 'TRUSTED';
}

function toModeration(v?: string): MeetModerationMode {
  if (v === 'ON' || v === 'OFF') return v;
  return 'OFF';
}

function mapSpaceResponse(
  raw: RawMeetSpace,
  meta: {
    buildingId: number | null;
    buildingAddr?: string;
    label: string;
    createdAt?: string;
  }
): MeetSpaceItem {
  if (!raw.name) {
    throw new Error('Google Meet API did not return a space name.');
  }
  return {
    name: raw.name,
    meetingUri: sanitizeExternalUrl(raw.meetingUri),
    meetingCode: raw.meetingCode || raw.name.replace(/^spaces\//, ''),
    accessType: toAccessType(raw.config?.accessType),
    moderation: toModeration(raw.config?.moderation),
    activeConferenceRecord: raw.activeConference?.conferenceRecord,
    buildingId: meta.buildingId,
    buildingAddr: meta.buildingAddr,
    label: meta.label,
    createdAt: meta.createdAt || new Date().toISOString(),
  };
}

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  const txt = await res.text();
  handleWorkspaceAuthError(res.status, txt);
  try {
    const parsed = JSON.parse(txt) as { error?: { message?: string } };
    return parsed?.error?.message || fallback;
  } catch {
    return fallback;
  }
}

export async function createMeetSpace(
  accessToken: string,
  options: {
    accessType: MeetAccessType;
    moderation: MeetModerationMode;
    buildingId: number | null;
    buildingAddr?: string;
    label: string;
  }
): Promise<MeetSpaceItem> {
  const res = await fetch('https://meet.googleapis.com/v2/spaces', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      config: {
        accessType: options.accessType,
        moderation: options.moderation,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(await parseErrorMessage(res, 'Unable to create Google Meet room.'));
  }

  const raw = (await res.json()) as RawMeetSpace;
  return mapSpaceResponse(raw, {
    buildingId: options.buildingId,
    buildingAddr: options.buildingAddr,
    label: options.label,
  });
}

export async function getMeetSpace(
  accessToken: string,
  spaceNameOrCode: string,
  meta: {
    buildingId: number | null;
    buildingAddr?: string;
    label?: string;
    createdAt?: string;
  } = { buildingId: null }
): Promise<MeetSpaceItem> {
  const resourceName = normalizeSpaceResourceName(spaceNameOrCode);
  const spaceId = encodeURIComponent(resourceName.slice('spaces/'.length));

  const res = await fetch(`https://meet.googleapis.com/v2/spaces/${spaceId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(await parseErrorMessage(res, 'Unable to find that Google Meet space.'));
  }

  const raw = (await res.json()) as RawMeetSpace;
  return mapSpaceResponse(raw, {
    buildingId: meta.buildingId,
    buildingAddr: meta.buildingAddr,
    label: meta.label || raw.meetingCode || 'Google Meet room',
    createdAt: meta.createdAt,
  });
}

export async function updateMeetSpaceSettings(
  accessToken: string,
  spaceName: string,
  settings: {
    accessType: MeetAccessType;
    moderation: MeetModerationMode;
  }
): Promise<RawMeetSpace> {
  const resourceName = normalizeSpaceResourceName(spaceName);
  const spaceId = encodeURIComponent(resourceName.slice('spaces/'.length));

  const res = await fetch(
    `https://meet.googleapis.com/v2/spaces/${spaceId}?updateMask=config.accessType,config.moderation`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          accessType: settings.accessType,
          moderation: settings.moderation,
        },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(await parseErrorMessage(res, 'Unable to update Google Meet room settings.'));
  }

  return (await res.json()) as RawMeetSpace;
}

export async function endMeetActiveConference(
  accessToken: string,
  spaceName: string
): Promise<void> {
  const resourceName = normalizeSpaceResourceName(spaceName);
  const spaceId = encodeURIComponent(resourceName.slice('spaces/'.length));

  const res = await fetch(`https://meet.googleapis.com/v2/spaces/${spaceId}:endActiveConference`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    throw new Error(
      await parseErrorMessage(res, 'Unable to end active conference (no live call may be running).')
    );
  }
}

export async function listMeetConferenceRecords(
  accessToken: string,
  pageSize = 8
): Promise<MeetConferenceSummary[]> {
  const res = await fetch(
    `https://meet.googleapis.com/v2/conferenceRecords?pageSize=${encodeURIComponent(
      String(pageSize)
    )}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!res.ok) {
    throw new Error(await parseErrorMessage(res, 'Unable to load Google Meet conference history.'));
  }

  const data = (await res.json()) as { conferenceRecords?: RawConferenceRecord[] };
  const records = data.conferenceRecords ?? [];

  const summaries = await Promise.all(
    records.map(async (r): Promise<MeetConferenceSummary> => {
      const recName = r.name || '';
      let participantCount: number | undefined;
      if (/^conferenceRecords\/[A-Za-z0-9_-]+$/.test(recName)) {
        try {
          const pRes = await fetch(
            `https://meet.googleapis.com/v2/${recName}/participants?pageSize=25`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            }
          );
          if (pRes.ok) {
            const pData = (await pRes.json()) as { participants?: unknown[] };
            participantCount = pData.participants?.length ?? 0;
          }
        } catch {
          // Optional enrichment failure should not block list display
        }
      }

      return {
        name: recName,
        space: r.space || '',
        startTime: r.startTime,
        endTime: r.endTime,
        participantCount,
      };
    })
  );

  return summaries;
}
