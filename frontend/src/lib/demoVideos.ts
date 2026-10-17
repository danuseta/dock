export interface DemoVideo { ticketKey: string; url: string; size: number; updatedAt?: string | null }

/** A link the ticket page can play in place: an MP4 file, as the S3 demo videos are. */
export const isPlayableVideo = (url?: string | null) => Boolean(url && /\.mp4(\?|#|$)/i.test(url));

export const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
