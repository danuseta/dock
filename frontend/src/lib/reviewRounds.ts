import { AUTO_REVIEW_LABEL, type AutoReviewRow, type ReviewImage } from '../agents/autoReviews';

export interface ReviewRound {
  id: string;
  status: string;
  summary: string;
  threadUrl: string;
  at: string;
  mode?: string | null;
  replyStatus?: string | null;
  replyAt?: string | null;
  replyText?: string | null;
  replyDetail?: string | null;
  replyImages?: ReviewImage[] | null;
}

export interface SessionRounds { id: string; ticketKey?: string | null; reviewRound?: ReviewRound | null }

export type HistoryKind = 'review' | 'round';

/** One line of a ticket's review history: a review your DOCK ran, or a round a teammate's DOCK sent you. */
export interface HistoryRow {
  id: string;
  kind: HistoryKind;
  round: number | null;
  at: string;
  who: string;
  text: string;
  mode: string | null;
  discord: string | null;
  discordAt: string | null;
  discordText: string | null;
  discordDetail: string | null;
  discordImages: ReviewImage[];
}

export const DISCORD_LABEL: Record<string, string> = {
  pending: 'pending', sending: 'sending', sent: 'sent', cancelled: 'cancelled', failed: 'failed', skipped: 'skipped',
};

/** A post without its DOCK marker line, which DOCK adds again on send, and the marker itself. */
export function splitMarker(text: string): { body: string; marker: string } {
  const lines = text.split(/\r?\n/);
  const last = lines[lines.length - 1] ?? '';
  return /^DOCK-(REVIEW|FIX)\b/.test(last) ? { body: lines.slice(0, -1).join('\n').trimEnd(), marker: last } : { body: text, marker: '' };
}

/** The marker line as a short muted line: "round 1 · @9f3c2a1 · Request change · 1 blocker". */
export function markerSummary(marker: string): string {
  const parts = marker.split(' · ').slice(marker.startsWith('DOCK-FIX') ? 0 : 1);
  return parts.map((part) => part.replace('DOCK-FIX ', '').replace('@ ', '@')).join(' · ');
}

/** An image as the owner checks it before the post goes out: "GAMBAR 1 · caption · file". */
export const imageLine = (image: ReviewImage) => [`GAMBAR ${image.n}`, image.caption, image.file].filter(Boolean).join(' · ');

export const isPending = (row: Pick<HistoryRow, 'discord'>) => row.discord === 'pending';

/** Review history of a ticket, oldest first: your DOCK's reviews with their post, and the teammate rounds with your reply. */
export function reviewHistory(autoReviews: AutoReviewRow[], rounds: ReviewRound[]): HistoryRow[] {
  const reviews: HistoryRow[] = autoReviews.map((row) => ({
    id: row.id,
    kind: 'review',
    round: row.round ?? null,
    at: row.startedAt,
    who: 'Your DOCK',
    text: `${AUTO_REVIEW_LABEL[row.status] ?? row.status} · ${row.headSha.slice(0, 7)}${row.detail ? ` · ${row.detail}` : ''}`,
    mode: null,
    discord: row.postStatus ?? null,
    discordAt: row.postAt ?? null,
    discordText: row.postText ?? null,
    discordDetail: row.postDetail ?? null,
    discordImages: row.postImages ?? [],
  }));
  const teammate: HistoryRow[] = rounds.map((round) => ({
    id: round.id,
    kind: 'round',
    round: null,
    at: round.at,
    who: "Teammate's DOCK",
    text: round.summary,
    mode: round.mode ?? null,
    discord: round.replyStatus ?? null,
    discordAt: round.replyAt ?? null,
    discordText: round.replyText ?? null,
    discordDetail: round.replyDetail ?? null,
    discordImages: round.replyImages ?? [],
  }));
  return [...reviews, ...teammate].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** The newest round a teammate's DOCK sent, if any: its findings and the runner that took them. */
export const latestRound = (rounds: ReviewRound[]): ReviewRound | null => rounds.reduce<ReviewRound | null>((newest, round) => (!newest || Date.parse(round.at) > Date.parse(newest.at) ? round : newest), null);

/** Whether a ticket has anything to show under Review findings. */
export const hasReviewHistory = (autoReviews: AutoReviewRow[], rounds: ReviewRound[]) => autoReviews.length > 0 || rounds.length > 0;

/** Tickets whose newest round went to the light runner. */
export const lightTickets = (sessions: SessionRounds[]): Set<string> => {
  const newest = new Map<string, ReviewRound>();
  for (const session of sessions) {
    const key = session.ticketKey?.toUpperCase();
    const round = session.reviewRound;
    if (key && round && (!newest.has(key) || Date.parse(round.at) > Date.parse((newest.get(key) as ReviewRound).at))) newest.set(key, round);
  }
  return new Set([...newest].filter(([, round]) => round.mode === 'light').map(([key]) => key));
};
