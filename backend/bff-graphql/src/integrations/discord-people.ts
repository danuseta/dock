import type { ThreadRow } from './discord-threads';
import { nameWords, personName, webhookReviewer } from './review-findings';

const DOCK_NAME = /^(.+?)\s*\(DOCK\)$/i;
const REVIEW_ID = /^DOCK-REVIEW on it by <@!?(\d+)>/m;

export interface DiscordPerson { id: string; person: string; names: string[] }

export function learnPeople(rows: ThreadRow[]): DiscordPerson[] {
  const people = new Map<string, DiscordPerson | null>();
  for (const message of rows.flatMap((row) => row.messages)) {
    const dock = message.webhookId ? DOCK_NAME.exec(message.author.trim()) : null;
    const id = dock ? REVIEW_ID.exec(message.text)?.[1] : undefined;
    if (!dock || !id) continue;
    const known = people.get(id);
    if (known === undefined) people.set(id, { id, person: dock[1].trim(), names: [] });
    else if (known && known.person !== dock[1].trim()) people.set(id, null);
  }
  for (const message of rows.flatMap((row) => row.messages)) {
    const known = message.webhookId ? null : people.get(message.authorId);
    if (known && !known.names.includes(message.author)) known.names.push(message.author);
  }
  return [...people.values()].filter((person): person is DiscordPerson => Boolean(person));
}

export function webhookPersonId(webhookName: string, people: DiscordPerson[], roster: string[]): string | undefined {
  const claimers = people.map((person) => ({ id: person.id, name: person.person }));
  return webhookReviewer(webhookName, claimers) ?? webhookReviewer(personName(webhookName, roster), claimers);
}

export function knownName(id: string | null | undefined, name: string, people: DiscordPerson[]): string {
  const person = people.find((item) => item.id === id)?.person;
  if (!person) return name;
  const words = new Set(nameWords(person));
  return nameWords(name).some((word) => words.has(word)) ? name : person;
}
