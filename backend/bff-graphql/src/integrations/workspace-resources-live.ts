import os from 'node:os';
import path from 'node:path';
import { JiraAPI } from '../datasources/JiraAPI';
import { StorageService } from '../storage/service';
import { orchestratorCron } from './orchestrator-cron-live';
import { eventPush } from './push';
import { WorkspaceResources, nodeFiles } from './workspace-resources';

const storage = new StorageService();
const jira = new JiraAPI();
const CACHE = 'workspace-resources';

/** The resources reader wired to the real cgroup and proc trees; DOCK_CGROUP_ROOT and DOCK_PROC_ROOT point it at a fixture. */
export const workspaceResources = new WorkspaceResources({
  files: nodeFiles,
  cgroupRoot: process.env.DOCK_CGROUP_ROOT || '/sys/fs/cgroup',
  procRoot: process.env.DOCK_PROC_ROOT || '/proc',
  home: os.homedir(),
  projectsDir: process.env.QONFLO_PROJECTS_DIR || path.join(os.homedir(), 'projects'),
  selfPid: process.pid,
  now: () => new Date(),
  statuses: async () => new Map((await jira.getTickets()).map((ticket: { key: string; status: string }) => [ticket.key, ticket.status])),
  inProgressStatus: async () => (await orchestratorCron.settings()).inProgressStatus,
  cacheGet: (key) => storage.getCache(CACHE, key),
  cacheSet: (key, value) => storage.upsertCache(CACHE, key, value, 2 * 24 * 3600),
  onOom: (today) => eventPush.send('needsYou', {
    title: 'Workspace ran out of memory',
    body: `${today} OOM ${today === 1 ? 'kill' : 'kills'} today. Home shows where the memory goes.`,
    url: '/',
    tag: 'workspace-oom',
  }),
  kill: (pid) => { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } },
});
