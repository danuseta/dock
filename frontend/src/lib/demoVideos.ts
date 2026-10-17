export interface DemoVideo { ticketKey: string; url: string; size: number; updatedAt?: string | null }

/** A link the ticket page can play in place: an MP4 file, as the S3 demo videos are. */
export const isPlayableVideo = (url?: string | null) => Boolean(url && /\.mp4(\?|#|$)/i.test(url));

export const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export interface DemoStorageView { configured: boolean; endpoint: string; region: string; bucket: string; folder: string; publicBaseUrl: string; accessKeyMasked?: string | null; secretSet: boolean }

/** The link a ticket's video gets with these settings, as the Settings card shows it. */
export const demoLinkExample = (storage?: Pick<DemoStorageView, 'publicBaseUrl' | 'folder'> | null) => (
  storage ? `${storage.publicBaseUrl.replace(/\/+$/, '')}/${storage.folder}/QRD-1234.mp4` : '<public base URL>/<folder>/QRD-1234.mp4'
);
