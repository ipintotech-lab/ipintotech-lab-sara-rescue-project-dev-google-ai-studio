import type { PickedDriveFile } from '../types/sara';
import { sanitizeExternalUrl } from './googleWorkspace';

interface GapiWindow {
  gapi?: {
    load: (
      api: string,
      options: { callback: () => void; onerror?: (err: unknown) => void }
    ) => void;
  };
  google?: {
    picker?: {
      PickerBuilder: new () => PickerBuilderInstance;
      DocsView: new (viewId?: string) => DocsViewInstance;
      ViewId: {
        DOCS: string;
        DOCS_IMAGES: string;
        SPREADSHEETS: string;
        FOLDERS: string;
      };
      Feature: {
        MULTISELECT_ENABLED: string;
        SUPPORT_DRIVES: string;
      };
      Action: {
        PICKED: string;
        CANCEL: string;
      };
    };
  };
}

interface DocsViewInstance {
  setIncludeFolders: (include: boolean) => DocsViewInstance;
  setSelectFolderEnabled: (select: boolean) => DocsViewInstance;
}

interface PickerBuilderInstance {
  addView: (view: unknown) => PickerBuilderInstance;
  enableFeature: (feature: string) => PickerBuilderInstance;
  setOAuthToken: (token: string) => PickerBuilderInstance;
  setCallback: (cb: (data: PickerCallbackData) => void) => PickerBuilderInstance;
  setOrigin: (origin: string) => PickerBuilderInstance;
  setTitle: (title: string) => PickerBuilderInstance;
  build: () => { setVisible: (visible: boolean) => void };
}

interface PickerDoc {
  id: string;
  name?: string;
  mimeType?: string;
  url?: string;
  iconUrl?: string;
  sizeBytes?: number;
  lastEditedUtc?: number;
}

interface PickerCallbackData {
  action: string;
  docs?: PickerDoc[];
}

let pickerLoadPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if ((window as unknown as GapiWindow).gapi) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Google API script')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google API script'));
    document.head.appendChild(script);
  });
}

export async function ensurePickerLoaded(): Promise<void> {
  const win = window as unknown as GapiWindow;
  if (win.google?.picker) return;

  if (!pickerLoadPromise) {
    pickerLoadPromise = (async () => {
      await loadScript('https://apis.google.com/js/api.js');
      const gapi = (window as unknown as GapiWindow).gapi;
      if (!gapi) {
        throw new Error('Google API client failed to initialize');
      }
      await new Promise<void>((resolve, reject) => {
        gapi.load('picker', {
          callback: () => resolve(),
          onerror: (err: unknown) => reject(err ?? new Error('Failed to load Google Picker')),
        });
      });
    })().catch((err) => {
      pickerLoadPromise = null;
      throw err;
    });
  }

  return pickerLoadPromise;
}

function getPickerOrigin(): string {
  const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList })
    .ancestorOrigins;
  if (ancestors && ancestors.length > 0) {
    return ancestors[ancestors.length - 1];
  }
  return window.location.origin;
}

export async function openGooglePicker({
  accessToken,
  buildingId = null,
  buildingAddr,
}: {
  accessToken: string;
  buildingId?: number | null;
  buildingAddr?: string;
}): Promise<PickedDriveFile[]> {
  await ensurePickerLoaded();

  const pickerNs = (window as unknown as GapiWindow).google?.picker;
  if (!pickerNs) {
    throw new Error('Google Picker API is not available');
  }

  return new Promise<PickedDriveFile[]>((resolve) => {
    const pickerOrigin = getPickerOrigin();

    const docsView = new pickerNs.DocsView(pickerNs.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    const picker = new pickerNs.PickerBuilder()
      .setTitle(
        buildingAddr
          ? `Select Google Drive files for ${buildingAddr}`
          : 'Select Google Drive files for SARA C2'
      )
      .addView(docsView)
      .addView(pickerNs.ViewId.DOCS_IMAGES)
      .addView(pickerNs.ViewId.SPREADSHEETS)
      .enableFeature(pickerNs.Feature.MULTISELECT_ENABLED)
      .enableFeature(pickerNs.Feature.SUPPORT_DRIVES)
      .setOAuthToken(accessToken)
      .setOrigin(pickerOrigin)
      .setCallback((data: PickerCallbackData) => {
        if (data.action === pickerNs.Action.PICKED && data.docs) {
          const nowIso = new Date().toISOString();
          const files: PickedDriveFile[] = data.docs.map((d) => ({
            id: d.id,
            name: d.name || 'Untitled file',
            mimeType: d.mimeType || 'application/octet-stream',
            url: sanitizeExternalUrl(d.url),
            iconUrl: sanitizeExternalUrl(d.iconUrl),
            sizeBytes: typeof d.sizeBytes === 'number' ? d.sizeBytes : undefined,
            lastEditedUtc: typeof d.lastEditedUtc === 'number' ? d.lastEditedUtc : undefined,
            buildingId,
            buildingAddr,
            attachedAt: nowIso,
          }));
          resolve(files);
        } else if (data.action === pickerNs.Action.CANCEL) {
          resolve([]);
        }
      })
      .build();

    picker.setVisible(true);
  });
}
