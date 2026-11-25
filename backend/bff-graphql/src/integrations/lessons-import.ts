// The one-off import into Agents › Lessons: every Judge result already in .evidence/judge/*.json, every Judge sprint summary in
// .evidence/retro/*-judge.json, and the closed ledgers (.evidence/<KEY>/status.json at stage done) of the sprints named. Sources
// are kept once per ref, so running it again adds nothing new; after it, the unprocessed count is the one Agents › Lessons shows.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseJudgeResult } from './judge';
import { judgeSessionSources, judgeSprintSources, ledgerSources, type SourceInput } from './lessons';
import { parseLedger } from './orchestrator';
import { parseRetroDraft } from './retro';

export interface ImportDeps {
  evidence: string;
  sprints: string[];
  service: { ingest(sources: SourceInput[]): Promise<{ added: number; processed: number }>; overview(): Promise<{ unprocessed: number }> };
  /** The ticket keys of a sprint (Jira); without it, or for a sprint it does not know, `keys` and the ledger dates decide. */
  sprintKeys?(sprint: string): Promise<string[] | null>;
  /** Extra ledger keys to import whatever their sprint. */
  keys?: string[];
  /** The ticket a judged session worked on. */
  ticketOf?(sessionId: string): Promise<string | null>;
  log?(line: string): void;
}

const KEY = /^[A-Z][A-Z0-9]+-\d+$|^CARD-[a-z0-9][a-z0-9-]{0,63}$/;
const readJson = async (file: string): Promise<unknown> => JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, ''));
const list = async (dir: string) => readdir(dir).catch(() => [] as string[]);

export async function importLessons(deps: ImportDeps): Promise<{ files: number; added: number; processed: number; unprocessed: number }> {
  const log = deps.log ?? (() => undefined);
  const sources: SourceInput[] = [];
  let files = 0;

  const judgeDir = path.join(deps.evidence, 'judge');
  for (const name of (await list(judgeDir)).filter((item) => item.endsWith('.json')).sort()) {
    try {
      const result = parseJudgeResult(await readJson(path.join(judgeDir, name)));
      const ticket = deps.ticketOf ? await deps.ticketOf(result.sessionId).catch(() => null) : null;
      sources.push(...judgeSessionSources(result.sessionId, ticket, result.findings));
      files += 1;
    } catch (error) {
      log(`skipped judge/${name}: ${error instanceof Error ? error.message : 'unreadable'}`);
    }
  }

  const retroDir = path.join(deps.evidence, 'retro');
  for (const name of (await list(retroDir)).filter((item) => item.endsWith('-judge.json')).sort()) {
    try {
      const draft = parseRetroDraft({ source: 'judge', ...(await readJson(path.join(retroDir, name)) as Record<string, unknown>) });
      sources.push(...judgeSprintSources(draft.sprint, draft.items));
      files += 1;
    } catch (error) {
      log(`skipped retro/${name}: ${error instanceof Error ? error.message : 'unreadable'}`);
    }
  }

  const wanted = new Set(deps.keys ?? []);
  for (const sprint of deps.sprints) {
    const keys = deps.sprintKeys ? await deps.sprintKeys(sprint).catch(() => null) : null;
    if (keys) for (const key of keys) wanted.add(key);
    else log(`no ticket list for ${sprint}; only --keys are imported for it`);
  }
  for (const key of (await list(deps.evidence)).filter((item) => KEY.test(item) && wanted.has(item)).sort()) {
    try {
      const raw = await readJson(path.join(deps.evidence, key, 'status.json'));
      const ledger = parseLedger(raw);
      if (ledger.stage !== 'done') {
        log(`skipped ${key}: stage ${ledger.stage}, not closed`);
        continue;
      }
      const pr = (raw as { pr?: { be?: unknown; fe?: unknown } }).pr;
      const urls = [ledger.prBe, ledger.prFe, typeof pr?.be === 'string' ? pr.be : null, typeof pr?.fe === 'string' ? pr.fe : null].filter((url): url is string => !!url);
      sources.push(...ledgerSources({ ...ledger, pullRequests: urls.map((url) => ({ url })) }));
      files += 1;
    } catch (error) {
      log(`skipped ${key}/status.json: ${error instanceof Error ? error.message : 'unreadable'}`);
    }
  }

  const { added, processed } = await deps.service.ingest(sources);
  const { unprocessed } = await deps.service.overview();
  return { files, added, processed, unprocessed };
}
