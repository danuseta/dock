import { JiraAPI, JiraTicketLookupError } from '../datasources/JiraAPI';
import { GitHubAPI } from '../datasources/GitHubAPI';
import { DiscordAPI } from '../datasources/DiscordAPI';
import { StorageAPI } from '../datasources/StorageAPI';
import { GraphQLError } from 'graphql';
import { shouldRequirePin, type AuthContext } from '../auth/session';
import { CalendarUnavailableError, googleCalendarService } from '../integrations/google-calendar';
import { upstreamMonitorService } from '../integrations/upstream-monitor';
import { dockerRuntimeService } from '../integrations/docker-runtime';
import { OrchestratorInputError, attentionItems, normalizeTicketKey, orchestratorService, type Orchestration } from '../integrations/orchestrator';
import { CHAT_MACHINE, chatService } from '../integrations/chat';
import { retroApplyPrompt, retroNumbers, retroProblems, retroTickets } from '../integrations/retro';
import { StorageService } from '../storage/service';
import { isSettledStatus, mergeAttention, withoutSettledTickets } from '../integrations/attention';
import { discordGateway, discordReader } from '../integrations/discord-reader-live';
import { isTeamChannel } from '../integrations/discord-team';
import { ChannelInputError, channelStore, isChannelKind, threadService, withJira } from '../integrations/discord-threads';
import { DiscordReaderError, ROW_VERSION } from '../integrations/discord-reader';
import { CronInputError, type OwnerAnswer, type OwnerChange } from '../integrations/orchestrator-cron';
import { orchestratorCron } from '../integrations/orchestrator-cron-live';
import { labelOrder } from '../integrations/orchestrator-cron';
import { pushService } from '../integrations/push';
import { demoVideos, withTitles } from '../integrations/demo-videos';
import { demoStorage, type DemoStorageInput } from '../integrations/demo-storage';
import { DevServerError, devServers } from '../integrations/dev-servers';
import { WorkspaceFilesError, workspaceFiles } from '../integrations/workspace-files';
import { elevenLabsKeys } from '../integrations/elevenlabs-keys';
import { broadcastDeps, sendBroadcast } from '../integrations/broadcast';
import { ReviewApprovalError, approvalRecords, lgtmReview } from '../integrations/review-approval';
import { decisionGate, heldWaiting } from '../integrations/decision-gate';
import { doctorReports } from '../integrations/doctor';
import { claudeUsage } from '../integrations/claude-usage';
import { claudeAccounts, claudeAccountsState, cycleAvailable } from '../integrations/claude-accounts-live';
import { agentLooks } from '../integrations/agent-looks';
import { agentBridge } from '../integrations/agents-live';
import type { AnswerInput } from '../integrations/chat-interactions';
import { SprintBusyError, SprintInputError, sprintDashboardService } from '../integrations/sprint-dashboard';
import { dockMode, ownRuns } from '../mode';
import { buildIssueBody, currentBuild, dockIssueError, draftUrl, issueEnvironment, issueTitle, issuesRepo, reporterName, type IssueDraft } from '../integrations/dock-issues';
import { ChangesInputError } from '../integrations/pull-changes';
import { pullChangesService } from '../integrations/pull-changes-live';

const jiraAPI = new JiraAPI();
const githubAPI = new GitHubAPI();
const discordAPI = new DiscordAPI();
const storageAPI = new StorageAPI();
const storageService = new StorageService();
const isPresent = <T>(value: T | null | undefined): value is T => value != null;

async function discordThreadsView() {
  const [config, status, channels, stored, owner] = await Promise.all([discordReader.config(), discordReader.status(), channelStore.list(), threadService.list(), storageAPI.getDiscordUserId()]);
  // A channel turned off or removed hides its threads now; the next sync drops them. A row of an older shape waits for
  // the sync that builds it again.
  const on = new Set(channels.filter((channel) => channel.enabled).map((channel) => channel.id));
  const rows = stored.filter((row) => on.has(row.channelId) && row.version === ROW_VERSION);
  const keys = [...new Set(rows.flatMap((row) => row.tickets))];
  const tickets = await Promise.all(keys.map((key) => jiraAPI.getTicket(key).catch(() => null)));
  const jira = new Map(tickets.filter(isPresent).map((ticket: any) => [String(ticket.key), {
    status: ticket.status ? String(ticket.status) : null,
    assignee: ticket.assignee ? String(ticket.assignee) : null,
    sprint: ticket.sprintState && ticket.sprintState !== 'NONE' ? String(ticket.sprintName) : null,
    sprintActive: ticket.sprintState === 'ACTIVE',
    labels: Array.isArray(ticket.labels) ? ticket.labels.map(String) : [],
  }]));
  const error = status.error ?? discordGateway.error;
  return { configured: Boolean(config), ownerSet: Boolean(owner), live: discordGateway.live, syncedAt: status.syncedAt, error, channels, rows: withJira(await discordReader.freshen(rows), jira, isSettledStatus, new Date()) };
}

function channelKind(kind: string) {
  if (!isChannelKind(kind)) throw new GraphQLError('kind must be bug, uat, pr or follow', { extensions: { code: 'BAD_USER_INPUT' } });
  return kind;
}

const changesInputError = (error: unknown): never => {
  if (error instanceof ChangesInputError) throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
  throw error;
};

const discordInputError = (error: unknown): never => {
  if (error instanceof ChannelInputError || error instanceof DiscordReaderError) throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
  throw error;
};

const retroItemView = (row: { id: string; kind: string; text: string; evidence: string; dest: string; status: string; sessionId: string | null; updatedAt: Date }) => {
  let evidence: string[] = [];
  try { evidence = JSON.parse(row.evidence); } catch { evidence = []; }
  return { ...row, evidence: Array.isArray(evidence) ? evidence.map(String) : [], updatedAt: row.updatedAt.toISOString() };
};

/** The runs of one sprint, read from the sprint dashboard's issue list. */
async function sprintRuns(sprintId: number) {
  let keys: string[] = [];
  try { keys = (JSON.parse(await sprintDashboardService.issueEvents(sprintId)) as Array<{ key?: unknown }>).map((issue) => String(issue.key)); } catch { keys = []; }
  const wanted = new Set(keys);
  return (await orchestratorService.list()).filter((run) => wanted.has(run.key));
}

async function retroView(sprintId?: number | null) {
  const sprints = [...await sprintDashboardService.listSprints()].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const sprint = sprintId != null ? sprints.find((item) => item.id === sprintId) : sprints.find((item) => item.state === 'active') ?? sprints[sprints.length - 1];
  if (!sprint) return null;
  const previous = sprints[sprints.indexOf(sprint) - 1] ?? null;
  const [runs, before, items] = await Promise.all([sprintRuns(sprint.id), previous ? sprintRuns(previous.id) : Promise.resolve(null), storageService.getRetroItems(sprint.name)]);
  return {
    sprint: sprint.name,
    sprintId: sprint.id,
    previous: previous?.name ?? null,
    numbers: retroNumbers(runs),
    previousNumbers: before ? retroNumbers(before) : null,
    problems: retroProblems(runs),
    tickets: retroTickets(runs),
    items: items.map(retroItemView),
  };
}

/** A new session on the workspace that runs one sous prompt, for the retro draft and for an accepted line. */
async function runSousPrompt(title: string, text: string) {
  requireAgentControls();
  if (!(await orchestratorService.machines()).includes(CHAT_MACHINE)) throw new GraphQLError('The workspace is not connected', { extensions: { code: 'BAD_USER_INPUT' } });
  const session = await chatService.createSession({ title, machine: CHAT_MACHINE }).catch(orchestratorInputError);
  await chatService.sendMessage(session.id, text, await orchestratorService.machines()).catch(orchestratorInputError);
  return session.id;
}

function orchestratorInputError(error: unknown): never {
  if (error instanceof OrchestratorInputError) {
    throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  throw error;
}

function sprintError(error: unknown): never {
  if (error instanceof SprintInputError || error instanceof SprintBusyError) {
    throw new GraphQLError(error.message, { extensions: { code: error instanceof SprintBusyError ? 'CONFLICT' : 'BAD_USER_INPUT' } });
  }
  throw error;
}

function requireCron(): void {
  if (dockMode() !== 'workspace') {
    throw new GraphQLError('The cron runs on the workspace DOCK.', { extensions: { code: 'BAD_USER_INPUT' } });
  }
}

function requireAgents(): void {
  if (dockMode() !== 'workspace') {
    throw new GraphQLError('Agent files are managed from the workspace DOCK.', { extensions: { code: 'BAD_USER_INPUT' } });
  }
}

// The laptop DOCK on the VPS only monitors its runs; agents are steered from the workspace DOCK.
function requireAgentControls(): void {
  if (dockMode() !== 'workspace') {
    throw new GraphQLError('This DOCK only monitors agents. Act on the workspace DOCK.', { extensions: { code: 'BAD_USER_INPUT' } });
  }
}

function requireDemoVideos(): void {
  if (dockMode() !== 'workspace') {
    throw new GraphQLError('Demo videos are kept from the workspace DOCK.', { extensions: { code: 'BAD_USER_INPUT' } });
  }
}

// A refusal of the bucket or the input is a message for the Demo Video page.
function demoVideoError(error: unknown): never {
  throw new GraphQLError(error instanceof Error ? error.message : 'Demo videos failed', { extensions: { code: 'BAD_USER_INPUT' } });
}

function requireWorkspace(): void {
  if (dockMode() !== 'workspace') {
    throw new GraphQLError('Dev servers run on the workspace DOCK.', { extensions: { code: 'BAD_USER_INPUT' } });
  }
}

function requireWorkspaceFiles(): void {
  if (dockMode() !== 'workspace') {
    throw new GraphQLError('The workspace folders are browsed on the workspace DOCK.', { extensions: { code: 'BAD_USER_INPUT' } });
  }
}

function workspaceFilesError(error: unknown): never {
  if (error instanceof WorkspaceFilesError) throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
  throw error;
}

function devServerError(error: unknown): never {
  if (error instanceof DevServerError) throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
  throw error;
}

// A key the laptop DOCK refused, or a peer it could not reach, is a message for the Settings page.
function elevenLabsError(error: unknown): never {
  throw new GraphQLError(error instanceof Error ? error.message : 'ElevenLabs keys failed', { extensions: { code: 'BAD_USER_INPUT' } });
}

function cronError(error: unknown): never {
  if (error instanceof CronInputError || error instanceof OrchestratorInputError) {
    throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  throw error;
}

async function hasMasterPin(): Promise<boolean> {
  return storageAPI.hasMasterPin();
}

async function requireUnlocked(context: AuthContext): Promise<void> {
  if (shouldRequirePin(context.request, await hasMasterPin()) && !context.authenticated) {
    throw new GraphQLError('Unlock DOCK to continue', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
}

export const resolvers = {
  Query: {
    authStatus: async (_: unknown, __: unknown, context: AuthContext) => {
      const pinEnabled = shouldRequirePin(context.request, await hasMasterPin());
      return {
        authenticated: !pinEnabled || context.authenticated,
        hasMasterPin: pinEnabled,
      };
    },
    // Public: the page needs it before the PIN to know which navigation to draw.
    dockMode: () => dockMode(),
    dockBuild: () => currentBuild() ?? 'unknown',
    dockIssues: async (_: unknown, { filter }: { filter: 'OPEN' | 'CLOSED' | 'MINE' }) => githubAPI.listDockIssues(filter),
    dockIssue: async (_: unknown, { number }: { number: number }) => githubAPI.getDockIssue(number),
    dockIssueDraftUrl: (_: unknown, draft: IssueDraft) => draftUrl(issuesRepo(), draft, issueEnvironment(draft.page)),
    retro: (_: unknown, { sprintId }: { sprintId?: number | null }) => retroView(sprintId),
    runThinking: async (_: unknown, { key }: { key: string }) => (await orchestratorService.thinking(key).catch(orchestratorInputError)) ?? [],
    runThinkingRaw: (_: unknown, { key, at, until }: { key: string; at: string; until?: string | null }) => orchestratorService.thinkingRaw(key, at, until).catch(orchestratorInputError),
    workspaceDir: async (_: unknown, { path }: { path?: string | null }) => {
      requireWorkspaceFiles();
      return workspaceFiles.dir(path).catch(workspaceFilesError);
    },
    workspaceFile: async (_: unknown, { path }: { path: string }) => {
      requireWorkspaceFiles();
      return workspaceFiles.file(path).catch(workspaceFilesError);
    },
    ownerName: () => reporterName(),
    dashboard: async () => {
      // Scatter-gather parallel fetching
      const [tickets] = await Promise.all([
        jiraAPI.getTickets(),
      ]);
      
      // Group tickets by status
      const groups: Record<string, any> = {};
      tickets.forEach((ticket: any) => {
        if (!groups[ticket.status]) {
          groups[ticket.status] = [];
        }
        groups[ticket.status].push(ticket);
      });
      
      const statusPriority = [
        'todo', 'to do', 'backlog',
        'in progress', 'in-progress', 'inprogress',
        'pr preview', 'review', 'in review', 'pull request preview',
        'uat merged', 'uat-merged',
        'uat check', 'uat-check', 'testing', 'qa',
        'uat/bugg improvement', 'uat/bug improvement', 'bug improvement', 'improvement',
        'ready for production', 'staging', 'release ready',
        'done/merged', 'done / merged', 'done', 'merged', 'closed'
      ];

      const getStatusRank = (st: string) => {
        const lower = st.toLowerCase().trim();
        const idx = statusPriority.findIndex(s => lower === s || lower.includes(s) || s.includes(lower));
        return idx !== -1 ? idx : 999;
      };

      return Object.keys(groups)
        .sort((a, b) => getStatusRank(a) - getStatusRank(b))
        .map(status => ({
          status,
          // Dashboard cards may request PR badges, but uncached GitHub work
          // must not keep the whole board in a loading state.
          tickets: groups[status].map((ticket: any) => ({ ...ticket, __dashboard: true }))
        }));
    },
    ticketDetail: async (_: any, { key }: { key: string }) => {
      // A free form card lives only in the ledger: Jira has nothing to show.
      if (/^card-/i.test(String(key).trim())) return null;
      try {
        return await jiraAPI.getTicket(key);
      } catch (error) {
        if (error instanceof JiraTicketLookupError) {
          throw new GraphQLError(error.message, {
            extensions: {
              code: 'SERVICE_UNAVAILABLE',
              retryable: true,
              statusCode: error.statusCode,
            },
          });
        }
        throw error;
      }
    },
    ticketRelationGroup: async (_: any, { ticketKey }: { ticketKey: string }) => {
      return storageAPI.getTicketRelationGroup(ticketKey);
    },
    discordThreads: () => discordThreadsView(),
    ticketChanges: (_: unknown, { ticketKey, tab }: { ticketKey: string; tab?: string | null }) => pullChangesService.changes(ticketKey, tab).catch(changesInputError),
    pullFilePatch: (_: unknown, { ticketKey, url, path }: { ticketKey: string; url: string; path: string }) => pullChangesService.filePatch(ticketKey, url, path).catch(changesInputError),
    pullFileLines: (_: unknown, args: { ticketKey: string; url: string; path: string; ref: string; from: number; to: number }) =>
      pullChangesService.fileLines(args.ticketKey, args.url, args.path, args.ref, args.from, args.to).catch(changesInputError),
    autoReviews: () => storageAPI.getAutoReviews(),
    claudeAccounts: () => claudeAccountsState(),
    needsAttention: async () => {
      const [agentItems, pullRequestItems] = await Promise.all([
        orchestratorService.list().then((runs) => attentionItems(ownRuns(runs))).catch((error) => {
          console.error('[BFF Orchestrator] Failed to load attention items:', error instanceof Error ? error.message : 'unknown error');
          return [];
        }),
        githubAPI.getNeedsAttention(),
      ]);
      const items = mergeAttention(agentItems, pullRequestItems);
      const keys = [...new Set(items.map((item) => item.ticketKey).filter(isPresent))];
      const tickets = await Promise.all(keys.map((key) => jiraAPI.getTicket(key).catch(() => null)));
      const statusOf = new Map(tickets.filter(isPresent).map((ticket: any) => [String(ticket.key), String(ticket.status)]));
      return withoutSettledTickets(items, statusOf);
    },
    settings: async () => {
      return await storageAPI.getPublicSettings();
    },
    jiraProjects: async (_: any, { url, email, token }: { url?: string, email?: string, token?: string }) => {
      return await jiraAPI.listProjects(url, email, token);
    },
    githubRepos: async (_: any, { token }: { token?: string }) => {
      return await githubAPI.listRepositories(token);
    },
    quickLinks: async () => storageAPI.getQuickLinks(),
    calendarEvents: async (_: any, args: { timeMin?: string, timeMax?: string, maxResults?: number }) => {
      try {
        return await googleCalendarService.listEvents(args.timeMin, args.timeMax, args.maxResults);
      } catch (error: any) {
        if (error.message === 'Google Calendar is not connected') return [];
        if (error instanceof CalendarUnavailableError) return [];
        console.error('[BFF Calendar] Failed to load events:', error.response?.status || error.message);
        return [];
      }
    },
    monitors: async (_: unknown, { refresh }: { refresh?: boolean }) => {
      return upstreamMonitorService.list(Boolean(refresh));
    },
    dockerRuntime: async (_: unknown, { includeStats }: { includeStats?: boolean }) => {
      return dockerRuntimeService.runtime(Boolean(includeStats));
    },
    orchestrations: async () => ownRuns(await orchestratorService.list()),
    orchestration: async (_: unknown, { key }: { key: string }) => {
      const [run] = ownRuns([await orchestratorService.get(key)].filter(isPresent));
      return run ?? null;
    },
    ingestTokens: async () => orchestratorService.tokens(),
    doctorReports: async () => doctorReports.list(),
    claudeUsage: async (_: unknown, { from, to }: { from: string; to: string }) => claudeUsage.usage(from, to).catch(orchestratorInputError),
    agentLooks: async () => agentLooks.list(),
    libraryAgents: async (_: unknown, { machine }: { machine?: string | null }) => {
      requireAgents();
      return agentBridge.list(machine || CHAT_MACHINE).catch(orchestratorInputError);
    },
    libraryAgent: async (_: unknown, { slug, machine }: { slug: string; machine?: string | null }) => {
      requireAgents();
      return agentBridge.get(machine || CHAT_MACHINE, slug).catch(orchestratorInputError);
    },
    demoVideos: async () => {
      requireDemoVideos();
      const [result, tickets] = await Promise.all([
        demoVideos.list(await storageAPI.listDemoLinks().catch(demoVideoError)).catch(demoVideoError),
        jiraAPI.getTickets().catch(() => []),
      ]);
      return { ...result, videos: withTitles(result.videos, tickets) };
    },
    demoStorage: async () => demoStorage.view().catch(demoVideoError),
    devServers: async () => { requireWorkspace(); return devServers.list(); },
    devServerLog: async (_: unknown, { name, bytes }: { name: string; bytes?: number | null }) => {
      requireWorkspace();
      try { return devServers.log(name, bytes ?? undefined); } catch (error) { return devServerError(error); }
    },
    elevenLabsKeys: async () => elevenLabsKeys.list().catch(elevenLabsError),
    elevenLabsQuota: async () => elevenLabsKeys.quota().catch(elevenLabsError),
    chatSessions: async (_: unknown, { source, limit }: { source?: string; limit?: number }) => {
      return chatService.sessions(source, limit, CHAT_MACHINE).catch(orchestratorInputError);
    },
    chatSession: async (_: unknown, { id }: { id: string }) => chatService.session(id, CHAT_MACHINE),
    chatSessionStates: async (_: unknown, { limit }: { limit?: number }) => chatService.sessionStates(limit, CHAT_MACHINE),
    chatMessages: async (_: unknown, args: { sessionId: string; afterId?: number; beforeId?: number; limit?: number }) => {
      return chatService.messages(args.sessionId, args.afterId, args.beforeId, args.limit)
        .then((rows) => chatService.withAttachments(rows)).catch(orchestratorInputError);
    },
    chatActivity: async (_: unknown, args: { sessionId: string; afterSeq?: number; fromTurnId?: number; beforeTurnId?: number; limit?: number }) => {
      return chatService.activityRows(args.sessionId, args).catch(orchestratorInputError);
    },
    chatSessionWorkers: async (_: unknown, { sessionId }: { sessionId: string }) => chatService.workers(sessionId),
    chatActivityDetail: async (_: unknown, { sessionId, id }: { sessionId: string; id: number }) => chatService.activityDetail(sessionId, id),
    chatSearch: async (_: unknown, { query, limit }: { query: string; limit?: number }) => chatService.search(query, limit, CHAT_MACHINE),
    chatBridge: async () => chatService.bridge(),
    chatMachines: async () => chatService.machinesWithInfo(await orchestratorService.machines()),
    chatCommands: async (_: unknown, { machine, query, limit }: { machine: string; query?: string | null; limit?: number | null }) => {
      return chatService.commands(machine, query, limit, await orchestratorService.machines()).catch(orchestratorInputError);
    },
    chatMachineOptions: async (_: unknown, { machine }: { machine: string }) => {
      return chatService.machineOptions(machine, await orchestratorService.machines()).catch(orchestratorInputError);
    },
    chatStatus: async (_: unknown, { machine }: { machine?: string | null }) => chatService.statusSnapshot(machine ?? undefined),
    chatBalloons: async () => chatService.balloons(),
    sprintList: async () => sprintDashboardService.listSprints(),
    sprintDashboard: async (_: unknown, { sprintId }: { sprintId?: number | null }) => sprintDashboardService.getDashboard(sprintId),
    sprintTrend: async () => sprintDashboardService.trend(),
    sprintIssueEvents: async (_: unknown, { sprintId }: { sprintId: number }) => sprintDashboardService.issueEvents(sprintId),
    sprintDashboardSettings: async () => sprintDashboardService.getSettings(),
    orchestratorCronSettings: async () => orchestratorCron.getSettings(),
    orchestratorCronStatus: async () => JSON.stringify(await orchestratorCron.status()),
    pushPublicKey: async () => pushService.publicKey(),
    dockerContainerLogs: async (_: unknown, { id, tail }: { id: string; tail?: number }) => {
      try {
        return await dockerRuntimeService.logs(id, tail);
      } catch (error) {
        if (error instanceof Error && error.message === 'Invalid container ID') {
          throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
        }
        console.error('[BFF Docker] Failed to load logs:', error instanceof Error ? error.message : 'unknown error');
        throw new GraphQLError('Container logs are unavailable', { extensions: { code: 'SERVICE_UNAVAILABLE' } });
      }
    },
  },
  
  Ticket: {
    labels: (parent: any) => Array.isArray(parent.labels) ? parent.labels : [],
    workOrder: async (parent: any) => (await storageAPI.ticketOrders()).get(parent.key) ?? labelOrder(parent.labels),
    workOrderSource: async (parent: any) => ((await storageAPI.ticketOrders()).has(parent.key) ? 'dock' : labelOrder(parent.labels) === null ? null : 'label'),
    workManual: async (parent: any) => (await storageAPI.manualTickets()).has(parent.key),
    pullRequests: async (parent: any) => {
      return await githubAPI.getPullRequestsForTicket(parent.key, {
        staleWhileRevalidate: parent.__dashboard === true,
      });
    },
    demoLink: async (parent: any) => {
      return await storageAPI.getDemoLink(parent.key);
    },
    orchestration: async (parent: any) => {
      const [run] = ownRuns([await orchestratorService.get(parent.key).catch(() => null)].filter(isPresent));
      return run ?? null;
    },
  },

  Orchestration: {
    approved: async (parent: { key: string }) => approvalRecords.approved(parent.key).catch(() => false),
    confirmedDecisions: async (parent: { key: string }) => decisionGate.confirmed(parent.key).catch(() => []),
    waiting: async (parent: Orchestration) => heldWaiting(parent, await decisionGate.confirmed(parent.key).catch(() => [])),
    events: async (parent: { key: string }) => orchestratorService.events(parent.key),
    timeline: async (parent: { key: string }) => orchestratorService.timeline(parent.key),
    members: async (parent: { key: string }) => orchestratorService.members(parent.key).catch(() => []),
  },

  TicketRelationGroup: {
    tickets: async (parent: { ticketKeys: string[] }) => {
      const tickets = await Promise.all(parent.ticketKeys.map((key) => jiraAPI.getTicket(key)));
      return tickets.filter(Boolean);
    },
  },

  MonitorTarget: {
    lastCheckedAt: (parent: any) => parent.lastCheckedAt?.toISOString?.() || parent.lastCheckedAt || null,
  },

  Settings: {
    googleCalendarError: () => googleCalendarService.lastError(),
  },

  Mutation: {
    retroBuild: async (_: unknown, { sprintId }: { sprintId: number }) => {
      const sprint = (await sprintDashboardService.listSprints()).find((item) => item.id === sprintId);
      if (!sprint) throw new GraphQLError('Unknown sprint', { extensions: { code: 'BAD_USER_INPUT' } });
      return runSousPrompt(`Retro-${sprint.name}`, `Pakai skill sous: retro ${sprint.name}`);
    },
    retroItemAction: async (_: unknown, { id, action, text }: { id: string; action: string; text?: string | null }) => {
      const item = await storageService.getRetroItem(id);
      if (!item) throw new GraphQLError('No such retro line', { extensions: { code: 'BAD_USER_INPUT' } });
      if (action === 'edit') {
        const next = (text ?? '').trim();
        if (!next) throw new GraphQLError('The line needs text', { extensions: { code: 'BAD_USER_INPUT' } });
        return retroItemView(await storageService.updateRetroItem(id, { text: next.slice(0, 1000) }));
      }
      if (action === 'close' || action === 'reopen') return retroItemView(await storageService.updateRetroItem(id, { status: action === 'close' ? 'closed' : 'open' }));
      if (action !== 'accept') throw new GraphQLError('action must be accept, close, reopen or edit', { extensions: { code: 'BAD_USER_INPUT' } });
      const view = retroItemView(item);
      const sessionId = item.dest === 'note' ? null : await runSousPrompt(`Retro-apply-${item.sprint}`, retroApplyPrompt(view));
      return retroItemView(await storageService.updateRetroItem(id, { status: 'accepted', sessionId }));
    },
    workspaceMkdir: async (_: unknown, { path }: { path: string }) => {
      requireWorkspaceFiles();
      return workspaceFiles.mkdir(path).catch(workspaceFilesError);
    },
    workspaceRename: async (_: unknown, { from, to }: { from: string; to: string }) => {
      requireWorkspaceFiles();
      return workspaceFiles.rename(from, to).catch(workspaceFilesError);
    },
    workspaceDelete: async (_: unknown, { path }: { path: string }) => {
      requireWorkspaceFiles();
      return workspaceFiles.remove(path).catch(workspaceFilesError);
    },
    lockSession: async (_: unknown, __: unknown, context: AuthContext) => {
      context.sessions.clear(context.request, context.response);
      return true;
    },
    saveDemoLink: async (_: any, { ticketKey, url }: { ticketKey: string, url: string }) => {
      return await storageAPI.saveDemoLink(ticketKey, url);
    },
    sendToDiscord: async (_: any, args: { ticketKey: string, customMessage?: string, threadId?: string, threadName?: string }) => {
      return sendBroadcast(broadcastDeps, args);
    },
    setTicketDependency: async (_: unknown, { ticketKey, dependsOnKey }: { ticketKey: string; dependsOnKey: string }) => {
      const [ticket, dependency] = await Promise.all([jiraAPI.getTicket(ticketKey), jiraAPI.getTicket(dependsOnKey)]);
      if (!ticket || !dependency) {
        throw new GraphQLError('Both Jira tickets must exist and be accessible', { extensions: { code: 'BAD_USER_INPUT' } });
      }
      try {
        return await storageAPI.setTicketDependency(ticket.key, dependency.key);
      } catch (error) {
        throw new GraphQLError(error instanceof Error ? error.message : 'Invalid ticket dependency', { extensions: { code: 'BAD_USER_INPUT' } });
      }
    },
    setTicketWorkOrder: async (_: unknown, { ticketKey, position }: { ticketKey: string; position: number }) => {
      requireAgentControls();
      await storageAPI.setTicketOrder(ticketKey, position).catch((error) => {
        throw new GraphQLError(error instanceof Error ? error.message : 'Invalid work order', { extensions: { code: 'BAD_USER_INPUT' } });
      });
      return true;
    },
    clearTicketWorkOrder: async (_: unknown, { ticketKey }: { ticketKey: string }) => {
      requireAgentControls();
      await storageAPI.clearTicketOrder(ticketKey);
      return true;
    },
    setTicketManual: async (_: unknown, { ticketKey, manual }: { ticketKey: string; manual: boolean }) => {
      requireAgentControls();
      await storageAPI.setTicketManual(ticketKey, manual).catch((error) => {
        throw new GraphQLError(error instanceof Error ? error.message : 'Invalid ticket', { extensions: { code: 'BAD_USER_INPUT' } });
      });
      return true;
    },
    clearTicketDependency: async (_: unknown, { ticketKey }: { ticketKey: string }) => {
      try {
        return await storageAPI.clearTicketDependency(ticketKey);
      } catch (error) {
        throw new GraphQLError(error instanceof Error ? error.message : 'Invalid ticket dependency', { extensions: { code: 'BAD_USER_INPUT' } });
      }
    },
    updateSettings: async (_: any, { input }: { input: any }) => {
      return await storageAPI.updateSettings(input);
    },
    validateJira: async (_: any, { url, email, token }: { url?: string, email?: string, token?: string }) => {
      return await jiraAPI.validateJira(url, email, token);
    },
    validateGitHub: async (_: any, { token }: { token?: string }) => {
      return await githubAPI.validateGitHub(token);
    },
    testDiscordReader: () => discordReader.test(),
    refreshDiscord: async () => {
      await discordReader.sync();
      return discordThreadsView();
    },
    dismissDiscordThread: (_: unknown, { id, lastActivity }: { id: string; lastActivity: string }) => threadService.dismiss(id, lastActivity),
    addDiscordChannel: async (_: unknown, { input, kind }: { input: string; kind: string }) => {
      await discordReader.addChannel(input, channelKind(kind)).catch(discordInputError);
      await discordReader.sync();
      return discordThreadsView();
    },
    updateDiscordChannel: async (_: unknown, { id, kind, enabled }: { id: string; kind: string; enabled: boolean }) => {
      const channel = (await channelStore.list()).find((entry) => entry.id === id);
      if (!channel) throw new GraphQLError('That channel is not followed', { extensions: { code: 'BAD_USER_INPUT' } });
      await channelStore.save({ ...channel, kind: channelKind(kind), enabled });
      await discordReader.sync();
      return discordThreadsView();
    },
    removeDiscordChannel: async (_: unknown, { id }: { id: string }) => {
      if (isTeamChannel(await channelStore.list(), id)) {
        throw new GraphQLError('This channel comes with the workspace. Switch it off instead.', { extensions: { code: 'BAD_USER_INPUT' } });
      }
      await channelStore.remove(id);
      await discordReader.sync();
      return discordThreadsView();
    },
    validateDiscord: async (_: any, { webhookUrl }: { webhookUrl?: string }) => {
      return await discordAPI.validateDiscord(webhookUrl);
    },
    setMasterPin: async (_: any, { pin }: { pin: string }, context: AuthContext) => {
      await requireUnlocked(context);
      const changed = await storageAPI.setMasterPin(pin);
      if (changed) {
        context.sessions.clearAll();
        context.sessions.create(context.response);
      }
      return changed;
    },
    changeMasterPin: async (_: any, { oldPin, newPin }: { oldPin: string, newPin: string }, context: AuthContext) => {
      const changed = await storageAPI.changeMasterPin(oldPin, newPin);
      if (changed) {
        context.sessions.clearAll();
        context.sessions.create(context.response);
      }
      return changed;
    },
    verifyMasterPin: async (_: any, { pin }: { pin: string }, context: AuthContext) => {
      const retryAfter = context.pinRateLimiter.retryAfterSeconds(context.clientKey);
      if (retryAfter > 0) {
        throw new GraphQLError('Too many PIN attempts. Try again later.', {
          extensions: { code: 'RATE_LIMITED', retryAfter },
        });
      }

      const valid = await storageAPI.verifyMasterPin(pin);
      if (!valid) {
        context.pinRateLimiter.recordFailure(context.clientKey);
        return false;
      }

      context.pinRateLimiter.reset(context.clientKey);
      context.sessions.create(context.response);
      return true;
    },
    removeMasterPin: async (_: any, { oldPin }: { oldPin: string }, context: AuthContext) => {
      const removed = await storageAPI.removeMasterPin(oldPin);
      if (removed) {
        context.sessions.clearAll();
        context.sessions.clear(context.request, context.response);
      }
      return removed;
    },
    refreshData: async () => {
      const result = await jiraAPI.refreshTickets();
      return result !== false;
    },
    checkConflicts: async (_: any, { owner, repo, pullNumber }: { owner: string, repo: string, pullNumber: number }) => {
      return await githubAPI.checkConflicts(owner, repo, pullNumber);
    },
    addQuickLink: async (_: any, { input }: { input: { title: string, url: string, color?: string } }) => {
      return storageAPI.addQuickLink(input);
    },
    removeQuickLink: async (_: any, { id }: { id: string }) => storageAPI.removeQuickLink(id),
    disconnectGoogleCalendar: async () => {
      await googleCalendarService.disconnect();
      return true;
    },
    addMonitor: async (_: unknown, { input }: { input: any }) => upstreamMonitorService.add(input),
    updateMonitor: async (_: unknown, { id, input }: { id: string, input: any }) => upstreamMonitorService.update(id, input),
    removeMonitor: async (_: unknown, { id }: { id: string }) => upstreamMonitorService.remove(id),
    checkMonitors: async () => upstreamMonitorService.checkAll(),
    createIngestToken: async (_: unknown, { name, machine }: { name: string; machine?: string | null }) => {
      return orchestratorService.createToken(name, machine).catch(orchestratorInputError);
    },
    revokeIngestToken: async (_: unknown, { id }: { id: string }) => orchestratorService.revokeToken(id),
    deleteDemoVideo: async (_: unknown, { ticketKey }: { ticketKey: string }) => { requireDemoVideos(); return demoVideos.remove(ticketKey).catch(demoVideoError); },
    saveDemoStorage: async (_: unknown, { input }: { input: DemoStorageInput }) => demoStorage.save(input).catch(demoVideoError),
    clearDemoStorage: async () => demoStorage.clear().catch(demoVideoError),
    startDevServer: async (_: unknown, { name }: { name: string }) => { requireWorkspace(); return devServers.start(name).catch(devServerError); },
    stopDevServer: async (_: unknown, { name }: { name: string }) => { requireWorkspace(); return devServers.stop(name).catch(devServerError); },
    restartDevServer: async (_: unknown, { name }: { name: string }) => { requireWorkspace(); return devServers.restart(name).catch(devServerError); },
    startAllDevServers: async () => { requireWorkspace(); return devServers.startAll().catch(devServerError); },
    stopAllDevServers: async () => { requireWorkspace(); return devServers.stopAll().catch(devServerError); },
    stopWorktreeServer: async (_: unknown, { port }: { port: number }) => { requireWorkspace(); return devServers.stopWorktree(port).catch(devServerError); },
    addElevenLabsKey: async (_: unknown, { name, key }: { name: string; key: string }) => elevenLabsKeys.add(name, key).then(() => true).catch(elevenLabsError),
    removeElevenLabsKey: async (_: unknown, { name }: { name: string }) => elevenLabsKeys.remove(name).catch(elevenLabsError),
    unparkElevenLabsKey: async (_: unknown, { name }: { name: string }) => elevenLabsKeys.park(name, null).then(() => true).catch(elevenLabsError),
    dismissOrchestration: async (_: unknown, { key }: { key: string }) => {
      requireAgentControls();
      return orchestratorService.dismiss(key, dockMode()).catch(orchestratorInputError);
    },
    createChatSession: async (_: unknown, args: { title?: string; ticketKey?: string; forkFrom?: string; machine?: string | null }) => {
      if (args.machine && args.machine !== CHAT_MACHINE) {
        throw new GraphQLError(`Chat sessions run on ${CHAT_MACHINE} only`, { extensions: { code: 'BAD_USER_INPUT' } });
      }
      if (!(await orchestratorService.machines()).includes(CHAT_MACHINE)) {
        throw new GraphQLError('Unknown machine', { extensions: { code: 'BAD_USER_INPUT' } });
      }
      return chatService.createSession({ ...args, machine: CHAT_MACHINE }).catch(orchestratorInputError);
    },
    sendChatMessage: async (
      _: unknown,
      { sessionId, text, attachmentIds, options, mode }: { sessionId: string; text: string; attachmentIds?: string[] | null; options?: unknown; mode?: string | null },
    ) => {
      return chatService.sendMessage(sessionId, text, await orchestratorService.machines(), { attachmentIds, options, mode }).catch(orchestratorInputError);
    },
    answerTicket: async (_: unknown, { ticketKey, text, issue }: { ticketKey: string; text: string; issue?: number | null }) => {
      requireAgentControls();
      // A sous ticket gets a new session on its machine; a ticket on the older flow keeps the answer in its own session.
      const sous = await Promise.resolve().then(() => orchestratorCron.sousRun(normalizeTicketKey(ticketKey))).catch(() => null);
      if (sous) {
        const answered = await orchestratorCron.answer(sous.key, text, issue).catch(cronError);
        await orchestratorService.recordEvent(sous.key, 'OWNER_REPLY', answered ? `I-${answered}: new session` : 'new session');
        return true;
      }
      await chatService.answerTicket(ticketKey, text, await orchestratorService.machines()).catch(orchestratorInputError);
      return true;
    },
    submitDecisions: async (
      _: unknown,
      { ticketKey, answers, changes, confirms }: { ticketKey: string; answers: OwnerAnswer[]; changes: OwnerChange[]; confirms: number[] },
    ) => {
      requireAgentControls();
      const key = await Promise.resolve().then(() => normalizeTicketKey(ticketKey)).catch(cronError);
      const run = await orchestratorService.get(key);
      if (!run) throw new GraphQLError('No run for this ticket', { extensions: { code: 'BAD_USER_INPUT' } });
      const confirmed = confirms.length
        ? await decisionGate.confirm(run, confirms).catch((error: Error) => { throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } }); })
        : await decisionGate.confirmed(key);
      await decisionGate.settle(run);
      if (answers.length || changes.length) {
        await orchestratorCron.submit(key, answers, changes).catch(cronError);
        const sent = [...answers.map((answer) => `I-${answer.issue}`), ...changes.map((change) => `D-${change.n}`)].join(', ');
        await orchestratorService.recordEvent(key, 'OWNER_REPLY', `${sent}: new session`);
      }
      return confirmed;
    },
    useClaudeAccount: async (_: unknown, { name }: { name: string }) => {
      if (!cycleAvailable()) throw new GraphQLError('This machine has no /cycle', { extensions: { code: 'BAD_USER_INPUT' } });
      try {
        return { available: true, ...(await claudeAccounts.use(name)) };
      } catch (error) {
        throw new GraphQLError(error instanceof Error ? error.message : 'The switch failed', { extensions: { code: 'BAD_USER_INPUT' } });
      }
    },
    setClaudeRotation: async (_: unknown, rule: { enabled: boolean; fiveHour: number; sevenDay: number; backToMain: boolean }) => {
      try {
        return { available: cycleAvailable(), ...(await claudeAccounts.setRotation(rule)) };
      } catch (error) {
        throw new GraphQLError(error instanceof Error ? error.message : 'The rotation was not saved', { extensions: { code: 'BAD_USER_INPUT' } });
      }
    },
    approveReview: async (_: unknown, { ticketKey }: { ticketKey: string }) => {
      try {
        return await lgtmReview(ticketKey);
      } catch (error) {
        if (error instanceof ReviewApprovalError) throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
        throw error;
      }
    },
    answerChatInteraction: async (
      _: unknown,
      args: { sessionId: string; id: number; decision: string; answers?: AnswerInput[] | null; note?: string | null },
    ) => {
      return chatService.answerInteraction(args.sessionId, args.id, args.decision, args.answers, args.note).catch(orchestratorInputError);
    },
    stopChatTurn: async (_: unknown, { sessionId }: { sessionId: string }) => chatService.stopTurn(sessionId).catch(orchestratorInputError),
    requestDoctorRun: async (_: unknown, { machine }: { machine: string }) => {
      return chatService.requestDoctor(machine, await orchestratorService.machines()).catch(orchestratorInputError);
    },
    saveAgentLook: async (_: unknown, { input }: { input: unknown }) => agentLooks.save(input).catch(orchestratorInputError),
    previewLibraryAgent: async (_: unknown, { input, machine }: { input: unknown; machine?: string | null }) => {
      requireAgents();
      return agentBridge.preview(machine || CHAT_MACHINE, input).catch(orchestratorInputError);
    },
    saveLibraryAgent: async (_: unknown, { input, machine }: { input: unknown; machine?: string | null }) => {
      requireAgents();
      return agentBridge.put(machine || CHAT_MACHINE, input).catch(orchestratorInputError);
    },
    deleteLibraryAgent: async (_: unknown, { slug, machine }: { slug: string; machine?: string | null }) => {
      requireAgents();
      const result = await agentBridge.delete(machine || CHAT_MACHINE, slug).catch(orchestratorInputError);
      if (result.ok) await agentLooks.remove(slug);
      return result;
    },
    renameChatSession: async (_: unknown, { id, title }: { id: string; title: string }) => {
      return chatService.renameSession(id, title).catch(orchestratorInputError);
    },
    setChatSessionOptions: async (_: unknown, { id, options }: { id: string; options: unknown }) => {
      return chatService.setSessionOptions(id, options).catch(orchestratorInputError);
    },
    deleteChatSession: async (_: unknown, { id }: { id: string }) => chatService.deleteSession(id),
    refreshSprintDashboard: async (_: unknown, { sprintId }: { sprintId: number }) => {
      try { return sprintDashboardService.startRefresh(sprintId); } catch (error) { return sprintError(error); }
    },
    backfillSprintDashboards: async (_: unknown, { count }: { count: number }) => {
      try { return sprintDashboardService.startBackfill(count); } catch (error) { return sprintError(error); }
    },
    updateSprintDashboardSettings: async (_: unknown, { boardId, config }: { boardId: string; config: string }) => {
      await sprintDashboardService.updateSettings(boardId, config).catch(sprintError);
      return true;
    },
    updateOrchestratorCronSettings: async (_: unknown, { config }: { config: string }) => {
      requireCron();
      await orchestratorCron.updateSettings(config).catch(cronError);
      return true;
    },
    runOrchestratorCronNow: async () => {
      requireCron();
      return JSON.stringify(await orchestratorCron.runFill(true));
    },
    confirmOrchestration: async (_: unknown, { key }: { key: string }) => {
      requireCron();
      await orchestratorCron.confirm(key).catch(cronError);
      return true;
    },
    stopAllAgents: async () => { requireAgentControls(); return orchestratorCron.stopAll(); },
    subscribePush: async (_: unknown, input: { endpoint: string; p256dh: string; auth: string }) => {
      await pushService.subscribe(input).catch(cronError);
      return true;
    },
    unsubscribePush: async (_: unknown, { endpoint }: { endpoint: string }) => {
      await pushService.unsubscribe(endpoint);
      return true;
    },
    sendTestPush: async () => pushService.send({ title: 'DOCK', body: 'Notifications work on this device.', url: '/' }),
    reportDockIssue: async (_: unknown, draft: IssueDraft) => {
      const title = issueTitle(draft.title);
      if (!title || !draft.happened.trim()) throw new GraphQLError('Title and what happened are required', { extensions: { code: 'BAD_USER_INPUT' } });
      return githubAPI.createDockIssue(title, buildIssueBody(draft, issueEnvironment(draft.page))).catch((error: any) => {
        throw dockIssueError(error);
      });
    },
  },
  ChatSession: {
    pending: async (session: { id: string; status: string; machine: string }) => chatService.pending(session.id, session.status, session.machine),
    settled: async (session: { id: string; status: string; machine: string }) => chatService.settled(session.id, session.status, session.machine),
  },
  DiscordChannel: {
    team: (channel: { team?: boolean }) => Boolean(channel.team),
  },
  ChatMessage: {
    attachments: (message: { attachments?: unknown[] }) => message.attachments ?? [],
  },
};

export const protectedQueries = [
  'dashboard', 'ticketDetail', 'ticketRelationGroup', 'needsAttention', 'discordThreads', 'ticketChanges', 'pullFilePatch', 'pullFileLines', 'autoReviews', 'claudeAccounts', 'jiraProjects', 'githubRepos', 'quickLinks', 'calendarEvents', 'monitors',
  'dockerRuntime', 'dockerContainerLogs', 'orchestrations', 'orchestration', 'ingestTokens', 'elevenLabsKeys', 'elevenLabsQuota', 'devServers', 'devServerLog', 'demoVideos', 'demoStorage',
  'chatSessions', 'chatSession', 'chatSessionStates', 'chatMessages', 'chatActivity', 'chatSessionWorkers', 'chatActivityDetail', 'chatSearch', 'chatBridge', 'chatMachines', 'chatStatus', 'chatBalloons',
  'chatCommands', 'chatMachineOptions', 'doctorReports', 'claudeUsage', 'agentLooks', 'libraryAgents', 'libraryAgent',
  'sprintList', 'sprintDashboard', 'sprintTrend', 'sprintDashboardSettings', 'sprintIssueEvents', 'orchestratorCronSettings', 'orchestratorCronStatus', 'pushPublicKey', 'ownerName',
  'dockBuild', 'dockIssues', 'dockIssue', 'dockIssueDraftUrl', 'workspaceDir', 'workspaceFile', 'runThinking', 'runThinkingRaw', 'retro',
] as const;
export const protectedMutations = [
  'retroBuild',
  'retroItemAction',
  'workspaceMkdir',
  'workspaceRename',
  'workspaceDelete',
  'saveDemoLink',
  'sendToDiscord',
  'setTicketDependency',
  'clearTicketDependency',
  'setTicketWorkOrder',
  'clearTicketWorkOrder',
  'setTicketManual',
  'updateSettings',
  'validateJira',
  'validateGitHub',
  'validateDiscord',
  'testDiscordReader',
  'refreshDiscord',
  'dismissDiscordThread',
  'addDiscordChannel',
  'updateDiscordChannel',
  'removeDiscordChannel',
  'changeMasterPin',
  'removeMasterPin',
  'refreshData',
  'checkConflicts',
  'addQuickLink',
  'removeQuickLink',
  'disconnectGoogleCalendar',
  'addMonitor',
  'updateMonitor',
  'removeMonitor',
  'checkMonitors',
  'createIngestToken',
  'useClaudeAccount',
  'setClaudeRotation',
  'revokeIngestToken',
  'deleteDemoVideo',
  'saveDemoStorage',
  'clearDemoStorage',
  'startDevServer',
  'stopDevServer',
  'restartDevServer',
  'startAllDevServers',
  'stopAllDevServers',
  'stopWorktreeServer',
  'addElevenLabsKey',
  'removeElevenLabsKey',
  'unparkElevenLabsKey',
  'dismissOrchestration',
  'createChatSession',
  'sendChatMessage',
  'answerTicket',
  'submitDecisions',
  'approveReview',
  'answerChatInteraction',
  'stopChatTurn',
  'renameChatSession',
  'requestDoctorRun',
  'saveAgentLook',
  'previewLibraryAgent',
  'saveLibraryAgent',
  'deleteLibraryAgent',
  'setChatSessionOptions',
  'deleteChatSession',
  'refreshSprintDashboard',
  'backfillSprintDashboards',
  'updateSprintDashboardSettings',
  'updateOrchestratorCronSettings',
  'runOrchestratorCronNow',
  'confirmOrchestration',
  'stopAllAgents',
  'subscribePush',
  'unsubscribePush',
  'sendTestPush',
  'reportDockIssue',
] as const;

for (const field of protectedQueries) {
  const resolver: any = resolvers.Query[field];
  (resolvers.Query as Record<string, any>)[field] = async (...args: any[]) => {
    await requireUnlocked(args[2] as AuthContext);
    return resolver(...args);
  };
}

for (const field of protectedMutations) {
  const resolver: any = resolvers.Mutation[field];
  (resolvers.Mutation as Record<string, any>)[field] = async (...args: any[]) => {
    await requireUnlocked(args[2] as AuthContext);
    return resolver(...args);
  };
}
