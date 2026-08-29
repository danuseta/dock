import { JiraAPI } from '../datasources/JiraAPI';
import { GitHubAPI } from '../datasources/GitHubAPI';
import { DiscordAPI } from '../datasources/DiscordAPI';
import { StorageAPI } from '../datasources/StorageAPI';
import { GraphQLError } from 'graphql';
import type { AuthContext } from '../auth/session';
import { googleCalendarService } from '../integrations/google-calendar';
import { upstreamMonitorService } from '../integrations/upstream-monitor';

const jiraAPI = new JiraAPI();
const githubAPI = new GitHubAPI();
const discordAPI = new DiscordAPI();
const storageAPI = new StorageAPI();

async function hasMasterPin(): Promise<boolean> {
  const settings = await storageAPI.getPublicSettings();
  return settings.hasMasterPin === true;
}

async function requireUnlocked(context: AuthContext): Promise<void> {
  if (await hasMasterPin() && !context.authenticated) {
    throw new GraphQLError('Unlock DOCK to continue', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
}

export const resolvers = {
  Query: {
    authStatus: async (_: unknown, __: unknown, context: AuthContext) => {
      const pinEnabled = await hasMasterPin();
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
          tickets: groups[status]
        }));
    },
    ticketDetail: async (_: any, { key }: { key: string }) => {
      return await jiraAPI.getTicket(key);
    },
    needsAttention: async () => {
      return await githubAPI.getNeedsAttention();
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
  },
  
  Ticket: {
    pullRequests: async (parent: any) => {
      return await githubAPI.getPullRequestsForTicket(parent.key);
    },
    demoLink: async (parent: any) => {
      return await storageAPI.getDemoLink(parent.key);
    }
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
      const ticket = await jiraAPI.getTicket(ticketKey);
      if (!ticket) return false;

      const prs = await githubAPI.getPullRequestsForTicket(ticketKey);
      const demoLink = await storageAPI.getDemoLink(ticketKey);
      const settings = await storageAPI.getSettings();
      
      const payload = {
        ticket: {
          key: ticket.key,
          title: ticket.title,
          url: ticket.url || `https://jira.example.com/browse/${ticket.key}`
        },
        prs,
        demoUrl: demoLink?.url,
        webhookUrl: settings.discordWebhookUrl,
        customMessage,
        threadId,
        threadName
      };
      
      return await discordAPI.sendSummary(payload);
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
  }
};

const protectedQueries = [
  'dashboard', 'ticketDetail', 'needsAttention', 'jiraProjects', 'githubRepos', 'quickLinks', 'calendarEvents', 'monitors',
] as const;
const protectedMutations = [
  'saveDemoLink',
  'sendToDiscord',
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
