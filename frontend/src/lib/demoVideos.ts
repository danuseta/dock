export interface DemoVideo { ticketKey: string; url: string; size?: number | null; updatedAt?: string | null; title?: string | null }

/** S3 for a video in the demo bucket (only those have a size), else the host the link points to. */
export function videoSource(video: Pick<DemoVideo, 'url' | 'size'>): string {
  if (video.size != null) return 'S3';
  try { return new URL(video.url).hostname.replace(/^www\./, ''); } catch { return 'link'; }
}

export type VideoSortColumn = 'ticket' | 'uploaded' | 'size';
export interface VideoSort { column: VideoSortColumn; dir: 'asc' | 'desc' }

/** The videos matching the search (key or title), in the chosen order; a missing date or size goes last. */
export function viewVideos(videos: DemoVideo[], query: string, sort: VideoSort): DemoVideo[] {
  const needle = query.trim().toLowerCase();
  const value = (video: DemoVideo): string | number | null => (
    sort.column === 'ticket' ? video.ticketKey : sort.column === 'size' ? video.size ?? null : video.updatedAt ? Date.parse(video.updatedAt) : null
  );
  return videos
    .filter((video) => !needle || `${video.ticketKey} ${video.title || ''}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      const first = value(a);
      const second = value(b);
      if (first == null || second == null) return first == null ? (second == null ? 0 : 1) : -1;
      const order = typeof first === 'string' ? first.localeCompare(second as string, undefined, { numeric: true }) : first - (second as number);
      return sort.dir === 'asc' ? order : -order;
    });
}

/** A link the ticket page can play in place: an MP4 file, as the S3 demo videos are. */
export const isPlayableVideo = (url?: string | null) => Boolean(url && /\.mp4(\?|#|$)/i.test(url));

export const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export interface DemoStorageView { configured: boolean; endpoint: string; region: string; bucket: string; folder: string; publicBaseUrl: string; accessKeyMasked?: string | null; secretSet: boolean }

/** The link a ticket's video gets with these settings, as the Settings card shows it. */
export const demoLinkExample = (storage?: Pick<DemoStorageView, 'publicBaseUrl' | 'folder'> | null) => (
  storage ? `${storage.publicBaseUrl.replace(/\/+$/, '')}/${storage.folder}/QRD-1234.mp4` : '<public base URL>/<folder>/QRD-1234.mp4'
);
