import { JiraAPI, JiraTicketLookupError } from '../datasources/JiraAPI';
import { GitHubAPI } from '../datasources/GitHubAPI';
import { DiscordAPI } from '../datasources/DiscordAPI';
import { StorageAPI } from '../datasources/StorageAPI';
import { GraphQLError } from 'graphql';
import { shouldRequirePin, type AuthContext } from '../auth/session';
import { googleCalendarService } from '../integrations/google-calendar';
import { upstreamMonitorService } from '../integrations/upstream-monitor';
import { dockerRuntimeService } from '../integrations/docker-runtime';
import { OrchestratorInputError, orchestratorService } from '../integrations/orchestrator';

const jiraAPI = new JiraAPI();
const githubAPI = new GitHubAPI();
const discordAPI = new DiscordAPI();
const storageAPI = new StorageAPI();
const isPresent = <T>(value: T | null | undefined): value is T => value != null;

function orchestratorInputError(error: unknown): never {
  if (error instanceof OrchestratorInputError) {
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
    needsAttention: async () => {
      const [agentItems, conflicts] = await Promise.all([
        orchestratorService.needsAttention().catch((error) => {
          console.error('[BFF Orchestrator] Failed to load attention items:', error instanceof Error ? error.message : 'unknown error');
          return [];
        }),
        githubAPI.getNeedsAttention(),
      ]);
      return [...agentItems, ...conflicts];
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
    orchestrations: async () => orchestratorService.list(),
    orchestration: async (_: unknown, { key }: { key: string }) => orchestratorService.get(key),
    ingestTokens: async () => orchestratorService.tokens(),
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
    pullRequests: async (parent: any) => {
      return await githubAPI.getPullRequestsForTicket(parent.key, {
        staleWhileRevalidate: parent.__dashboard === true,
      });
    },
    demoLink: async (parent: any) => {
      return await storageAPI.getDemoLink(parent.key);
    },
    orchestration: async (parent: any) => {
      return orchestratorService.get(parent.key).catch(() => null);
    },
  },

  Orchestration: {
    events: async (parent: { key: string }) => orchestratorService.events(parent.key),
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

  Mutation: {
    lockSession: async (_: unknown, __: unknown, context: AuthContext) => {
      context.sessions.clear(context.request, context.response);
      return true;
    },
    saveDemoLink: async (_: any, { ticketKey, url }: { ticketKey: string, url: string }) => {
      return await storageAPI.saveDemoLink(ticketKey, url);
    },
    sendToDiscord: async (_: any, { ticketKey, customMessage, threadId, threadName }: { ticketKey: string, customMessage?: string, threadId?: string, threadName?: string }) => {
      const relation = await storageAPI.getTicketRelationGroup(ticketKey);
      const tickets = (await Promise.all(relation.ticketKeys.map((key) => jiraAPI.getTicket(key)))).filter(isPresent);
      if (tickets.length === 0) return false;

      const [pullRequestGroups, demoLinks] = await Promise.all([
        Promise.all(tickets.map((ticket) => githubAPI.getPullRequestsForTicket(ticket.key))),
        Promise.all(tickets.map((ticket) => storageAPI.getDemoLink(ticket.key))),
      ]);
      const prs = [...new Map(pullRequestGroups.flat().map((pr: any) => [pr.url || pr.id, pr])).values()];
      const primaryTicket = tickets.find((ticket) => ticket.key === relation.primaryKey) || tickets[0];
      if (!primaryTicket) return false;
      const settings = await storageAPI.getSettings();
      const demoEntries = demoLinks
        .map((demoLink, index) => ({ key: tickets[index]?.key, url: demoLink?.url }))
        .filter((entry): entry is { key: string; url: string } => Boolean(entry.key && entry.url));
      const uniqueDemoUrls = [...new Set(demoEntries.map((entry) => entry.url))];

      const payload = {
        ticket: {
          key: primaryTicket.key,
          title: primaryTicket.title,
          url: primaryTicket.url || `https://jira.example.com/browse/${primaryTicket.key}`
        },
        relatedTickets: tickets.map((ticket) => ({
          key: ticket.key,
          title: ticket.title,
          url: ticket.url || `https://jira.example.com/browse/${ticket.key}`,
        })),
        prs,
        demoUrl: (uniqueDemoUrls.length === 1
          ? `- **${tickets.map((ticket) => ticket.key).join(' + ')}:** ${uniqueDemoUrls[0]}`
          : demoEntries.map((entry) => `- **${entry.key}:** ${entry.url}`).join('\n')) || undefined,
        webhookUrl: settings.discordWebhookUrl,
        messageTemplate: settings.discordMessageTemplate,
        customMessage,
        threadId,
        threadName
      };
      
      return await discordAPI.sendSummary(payload);
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
    createIngestToken: async (_: unknown, { name }: { name: string }) => {
      return orchestratorService.createToken(name).catch(orchestratorInputError);
    },
    revokeIngestToken: async (_: unknown, { id }: { id: string }) => orchestratorService.revokeToken(id),
    dismissOrchestration: async (_: unknown, { key }: { key: string }) => {
      return orchestratorService.dismiss(key).catch(orchestratorInputError);
    },
  }
};

const protectedQueries = [
  'dashboard', 'ticketDetail', 'ticketRelationGroup', 'needsAttention', 'jiraProjects', 'githubRepos', 'quickLinks', 'calendarEvents', 'monitors',
  'dockerRuntime', 'dockerContainerLogs', 'orchestrations', 'orchestration', 'ingestTokens',
] as const;
const protectedMutations = [
  'saveDemoLink',
  'sendToDiscord',
  'setTicketDependency',
  'clearTicketDependency',
  'updateSettings',
  'validateJira',
  'validateGitHub',
  'validateDiscord',
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
  'revokeIngestToken',
  'dismissOrchestration',
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
