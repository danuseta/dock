export interface AutoReviewRow {
  id: string;
  ticketKey: string;
  prUrl: string;
  headSha: string;
  threadUrl: string;
  sessionId: string | null;
  status: string;
  detail: string | null;
  startedAt: string;
  finishedAt: string | null;
  round?: number;
  postStatus?: string | null;
  postAt?: string | null;
  postText?: string | null;
  postDetail?: string | null;
  postImages?: ReviewImage[] | null;
}

/** An image of a review post or reply, as DOCK labels it: "GAMBAR N" with a caption, from a file in screenshots/. */
export interface ReviewImage { n: number; file: string; caption: string }

export const AUTO_REVIEW_LABEL: Record<string, string> = {
  running: 'Reviewing',
  deciding: 'Reviewing',
  lgtm: 'Auto LGTM',
  clean: 'Clean, LGTM it',
  blockers: 'Needs you',
  failed: 'Failed',
};

/** `owner/repo#12` of a pull request link. */
export const prLabel = (url: string) => url.replace(/^https:\/\/github\.com\//, '').replace('/pull/', '#');

/** The newest auto review of each ticket; the list arrives newest first. */
export function latestByTicket(rows: AutoReviewRow[]): Map<string, AutoReviewRow> {
  const latest = new Map<string, AutoReviewRow>();
  for (const row of rows) if (!latest.has(row.ticketKey)) latest.set(row.ticketKey, row);
  return latest;
}
