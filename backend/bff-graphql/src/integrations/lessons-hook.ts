// What the prompt builders, the Judge sprint summary and the owner's decision changes hand to Agents › Lessons. lessons-live.ts
// fills these in at startup, so the modules that call them do not import it; until then (and in tests) a prompt has no lessons
// line and nothing is ingested.
export const lessonHooks: {
  /** Writes the ticket's .evidence/lessons/<KEY>.md and answers its absolute path; null when the key has none. */
  file: ((key: string) => Promise<string | null>) | null;
  /** The Judge sprint summary's lines, after the draft is stored. */
  retroDraft: ((sprint: string, items: Array<{ kind: string; text: string; evidence: string[]; dest: string; source: string }>) => Promise<unknown>) | null;
  /** Decisions of a sous ticket the owner changed, with their status before the change. */
  ownerChanged: ((key: string, changes: Array<{ n: number; status: string; choice: string }>) => Promise<unknown>) | null;
} = { file: null, retroDraft: null, ownerChanged: null };

/** The ticket's lessons file for a prompt; null when lessons are not wired or the file cannot be written. */
export async function lessonsFileFor(key: string | null | undefined): Promise<string | null> {
  if (!key || !lessonHooks.file) return null;
  try {
    return await lessonHooks.file(key);
  } catch {
    return null;
  }
}

export const ownerChanged = async (key: string, changes: Array<{ n: number; status: string; choice: string }>) => (lessonHooks.ownerChanged ? lessonHooks.ownerChanged(key, changes) : null);
