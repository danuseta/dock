/** What Kontrak shows beside the contract: the ticket's demo video and its design or storyboard. */
export interface DraftStoryboard { epic: string; version: number; frames: number; htmlUrl: string | null }

interface DraftLike {
  tickets: Array<{ key: string; epic?: string | null; storyboard?: { version: number | null; frames?: unknown[] | null } | null }>;
  storyboards: Array<{ epic: string; version: number | null; frames: number; htmlUrl?: string | null }>;
}

/** The storyboard version the sprint draft holds for the ticket; null when the draft has none for it. */
export function draftStoryboard(draft: DraftLike | null | undefined, key: string): DraftStoryboard | null {
  const ticket = draft?.tickets.find((item) => item.key === key);
  if (!ticket?.epic) return null;
  const board = draft?.storyboards.find((item) => item.epic === ticket.epic);
  const version = ticket.storyboard?.version ?? board?.version ?? null;
  if (version === null || version === undefined) return null;
  const frames = Array.isArray(ticket.storyboard?.frames) ? ticket.storyboard.frames.length : board?.frames ?? 0;
  return { epic: ticket.epic, version, frames, htmlUrl: board?.htmlUrl ?? null };
}

