import { StorageService } from '../storage/service';
import { blackboard } from './blackboard';
import { loadAcTrace } from './ac-trace';
import { CHAT_MACHINE, STALE_TEXT, SILENT_TEXT, STOPPED_QUEUED_TEXT, STOPPED_TEXT, chatService } from './chat';
import { TAKEN_HARD_TEXT } from './chat-interactions';
import { threadService } from './discord-threads';
import { orchestratorService, parseLedger } from './orchestrator';
import { orchestratorCron } from './orchestrator-cron-live';
import { findings as threadFindings } from './review-findings';
import { retroNumbers } from './retro';
import { sprintDashboardService } from './sprint-dashboard';
import { JUDGE_SETTINGS_KEY, effectiveCall, sprintDays, storedJudgeSettings } from './judge';
import { buildSessionInput, buildSprintInput, cleanJudgeInputs, judgeInputDir, writeJudgeInput, type InputExample } from './judge-input';
import { JudgeQueue, withActiveSprint, type JudgeSprintRef } from './judge-queue';
import { sprintDraftService } from './sprint-draft-live';
import type { PlanningSprint } from './jira-sprint';

const storage = new StorageService();
const CUT_TEXTS = new Set([STALE_TEXT, SILENT_TEXT, TAKEN_HARD_TEXT, STOPPED_TEXT, STOPPED_QUEUED_TEXT]);
const MAX_EXEC_LINES = 40;

const examplesOf = (rows: Array<{ cause: string; text: string; note: string | null }>): InputExample[] => rows.map((row) => ({ cause: row.cause, text: row.text, note: row.note }));

const sprintIssues = async (sprint: JudgeSprintRef): Promise<Array<{ key: string; events?: Array<{ at: string; field: string; from: string | null; to: string | null }> }>> => {
  try {
    const issues = JSON.parse(await sprintDashboardService.issueEvents(sprint.id));
    return Array.isArray(issues) ? issues : [];
  } catch {
    return [];
  }
};

/** What the run, its board and its threads say about the session's ticket, for the condensed transcript. */
async function ticketContext(key: string, since: Date) {
  const [run, row, checkpoints, timeline, threads, sprints] = await Promise.all([
    orchestratorService.get(key).catch(() => null),
    storage.getOrchestratorRunWithLedger(key).catch(() => null),
    orchestratorService.checkpoints(key).catch(() => []),
    orchestratorService.timeline(key).catch(() => null),
    threadService.stored().catch(() => new Map()),
    sprintDashboardService.listSprints().catch(() => []),
  ]);
  let coverage = null;
  if (row) {
    try {
      const ledger = parseLedger(JSON.parse(row.ledgerRaw || row.payload));
      const trace = await loadAcTrace(blackboard, key, { ac: ledger.ac, prBe: ledger.prBe, prFe: ledger.prFe });
      if (trace?.readable && trace.total > 0) {
        coverage = { covered: trace.covered, total: trace.total, missing: trace.lines.filter((line) => !line.refs.some((ref) => ref.line !== null)).map((line) => `${line.label}${line.text ? ` ${line.text}` : ''}`) };
      }
    } catch { /* an unreadable ledger or board leaves the coverage out */ }
  }
  const execLog = [
    ...(timeline?.visits ?? []).flatMap((visit) => visit.agents.filter((agent) => agent.parentId && agent.since && agent.since >= since.toISOString()).map((agent) => ({
      at: agent.since as string, line: `${(agent.since as string).slice(11, 16)} ${agent.name} · ${agent.detail ?? ''} · ${agent.state} · ${agent.tools} tools`,
    }))),
    ...(run?.failures ?? []).filter((failure) => failure.at >= since.toISOString()).map((failure) => ({ at: failure.at, line: `${failure.at.slice(11, 16)} FAIL ${failure.type} #${failure.attempt}: ${failure.what ?? failure.evidence}` })),
  ].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_EXEC_LINES).map((entry) => entry.line);
  const discord = [...threads.values()].filter((thread) => thread.kind === 'pr' && thread.tickets.includes(key))
    .flatMap((thread) => threadFindings(thread, since.getTime()).map((message) => ({ at: message.at, author: message.author, text: message.text, url: `${thread.url}/${message.id}` })));
  const active = sprints.filter((sprint) => sprint.endDate >= since.toISOString());
  const jira = (await Promise.all(active.map(sprintIssues))).flat().filter((issue) => issue.key === key)
    .flatMap((issue) => (issue.events ?? []).filter((event) => event.field === 'status' && event.at >= since.toISOString()).map((event) => ({ at: event.at, from: event.from, to: event.to })));
  return {
    ledger: run ? {
      stage: run.stage,
      rounds: run.closing?.fixRounds ?? run.rounds?.used ?? 0,
      failures: run.failures.map((failure) => `${failure.type}: ${failure.what ?? failure.evidence} (attempt ${failure.attempt})`),
      findings: run.findings.map((finding) => `${finding.severity}: ${finding.text}${finding.resolvedAt ? ' (resolved)' : ''}`),
      ownerIssues: run.issues.filter((issue) => issue.level === 'owner').map((issue) => `I-${issue.n} ${issue.type}: ${issue.text} (${issue.status})`),
    } : null,
    checkpoints: checkpoints.filter((card) => card.at >= since.toISOString()).map((card) => ({ at: card.at, step: card.step, agent: card.agent, text: card.text })),
    execLog,
    coverage,
    discord: [...new Map(discord.map((message) => [message.url, message])).values()],
    jira: [...new Map(jira.map((change) => [`${change.at}${change.to}`, change])).values()],
  };
}

/** The model of the family the machine offers (sonnet for a session, opus for the sprint), or none to keep the default. */
async function modelOf(family: string): Promise<string | null> {
  const options = await chatService.machineOptions(CHAT_MACHINE, await orchestratorService.machines()).catch(() => null);
  return options?.models.find((model) => `${model.value} ${model.label}`.toLowerCase().includes(family))?.value ?? null;
}

const LIVE_SPRINT_MS = 5 * 60 * 1000;
let liveSprint: { at: number; sprint: PlanningSprint | null } | null = null;

/** The sprint Jira calls active, as Planning reads it; read again after five minutes, the last answer kept when Jira fails. */
async function liveActiveSprint(): Promise<PlanningSprint | null> {
  if (liveSprint && Date.now() - liveSprint.at < LIVE_SPRINT_MS) return liveSprint.sprint;
  const sprint = await sprintDraftService.sprints().then((list) => list.find((item) => item.state === 'active' && item.startDate) ?? null).catch(() => liveSprint?.sprint ?? null);
  liveSprint = { at: Date.now(), sprint };
  return sprint;
}

const sprints = async (): Promise<JudgeSprintRef[]> => withActiveSprint(
  (await sprintDashboardService.listSprints()).map((sprint) => ({ id: sprint.id, name: sprint.name, state: sprint.state, startDate: sprint.startDate, endDate: sprint.endDate })),
  await liveActiveSprint(),
);

export const judgeQueue = new JudgeQueue({
  store: storage,
  now: () => new Date(),
  settings: async () => storedJudgeSettings((await storage.getSettingValues([JUDGE_SETTINGS_KEY]))[0]?.value),
  machine: CHAT_MACHINE,
  online: (machine) => chatService.bridge(machine).online,
  ticketStatuses: async () => new Map((await storage.getOrchestratorRuns()).filter((run) => run.jiraStatus).map((run) => [run.key, String(run.jiraStatus)])),
  sessionInput: async (row, examples) => {
    const session = await storage.getChatSession(row.sessionId);
    if (!session) throw new Error('the session is gone');
    const [messages, tools] = await Promise.all([storage.getJudgeMessages(row.sessionId, null), storage.getJudgeActivity(row.sessionId)]);
    const context = session.ticketKey ? await ticketContext(session.ticketKey, session.startedAt) : { ledger: null, checkpoints: [], execLog: [], coverage: null, discord: [], jira: [] };
    return buildSessionInput({
      session: { id: session.id, title: session.title, ticketKey: session.ticketKey, origin: session.origin, startedAt: session.startedAt },
      since: row.judgedUntilMessageId,
      messages,
      tools: tools.map((tool) => ({ name: tool.name, label: tool.label, summary: tool.summary, detail: tool.detail, status: tool.status, agent: tool.agent, startedAt: tool.startedAt })),
      ...context,
      examples: examplesOf(examples),
    });
  },
  sprintInput: async (sprint, notJudged, examples) => {
    const now = new Date();
    const days = sprintDays(sprint.startDate, sprint.endDate, now);
    const [rows, findings, all] = await Promise.all([storage.getJudgeSessions({ days }), storage.getJudgeFindings({ days }), sprints()]);
    const answers = new Map((await storage.getJudgeDays(days)).map((day) => [day.day, day]));
    const chats = new Map((await storage.getChatSessionsByIds([...new Set(findings.map((finding) => finding.sessionId))])).map((chat) => [chat.id, chat]));
    const grades = new Map(rows.map((row) => [row.sessionId, row.grade]));
    const keys = new Set((await sprintIssues(sprint)).map((issue) => issue.key));
    const runs = (await orchestratorService.list()).filter((run) => keys.has(run.key));
    const ordered = [...all].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const previous = ordered[ordered.findIndex((item) => item.name === sprint.name) - 1] ?? null;
    const lastTry = previous ? (await storage.getRetroItems(previous.name)).filter((item) => item.kind === 'try' && item.status === 'accepted').map((item) => item.text) : [];
    return buildSprintInput({
      sprint: sprint.name,
      days,
      sessionsJudged: rows.filter((row) => row.status === 'judged').length,
      notJudged,
      findings: findings.filter((finding) => effectiveCall(finding) === 'mistake').map((finding) => ({
        day: finding.day, sessionId: finding.sessionId, sessionTitle: chats.get(finding.sessionId)?.title || finding.sessionId.slice(0, 8), grade: grades.get(finding.sessionId) ?? null,
        cause: finding.cause, text: finding.text, quote: finding.quote, shouldHave: finding.shouldHave, confirmed: Boolean(answers.get(finding.day)?.confirmedAt) || finding.ownerCall !== null,
      })),
      numbers: runs.length ? { ...retroNumbers(runs) } : null,
      lastTry,
      previousSprint: previous?.name ?? null,
      examples: examplesOf(examples),
    });
  },
  writeInput: (name, text) => writeJudgeInput(judgeInputDir(), name, text),
  cleanInputs: (before) => cleanJudgeInputs(judgeInputDir(), before),
  open: async ({ title, prompt, account, model }) => orchestratorCron.openJudge(title, prompt, account, await modelOf(model)),
  turnState: async (chatId) => {
    const session = await storage.getChatSession(chatId);
    if (!session) return { state: 'gone', detail: null };
    if (session.status === 'running' || session.status === 'queued' || await storage.countChatMessagesInState(chatId, ['queued', 'taken', 'held', 'steer']) > 0) return { state: 'running', detail: null };
    if (session.statusDetail && CUT_TEXTS.has(session.statusDetail)) return { state: 'cut', detail: session.statusDetail };
    if (session.status === 'error') return { state: 'failed', detail: session.statusDetail };
    return { state: 'done', detail: null };
  },
  sprints,
});
