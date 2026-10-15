import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from './client';
import { decrypt, encrypt, hashPin, verifyPin } from './crypto';

const RUN_WITHOUT_LEDGER = {
  key: true, title: true, stage: true, waiting: true, payload: true, activity: true, activityDetail: true, activityEndedAt: true,
  lastEventAt: true, ledgerUpdatedAt: true, transcriptAt: true, dismissedAt: true, machine: true, handover: true, createdAt: true, updatedAt: true,
} as const;

const SENSITIVE_KEYS = new Set([
  'jiraApiToken',
  'githubToken',
  'discordWebhookUrl',
  'orchestratorCronWebhookUrl',
  'pushVapidPrivateKey',
  'googleClientSecret',
  'googleRefreshToken',
]);

export interface ChatActivityInput {
  eventId: string;
  parentId: string | null;
  kind: string;
  agent: string;
  name: string;
  label: string;
  summary: string;
  detail: string | null;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
}

export interface ChatInteractionInput {
  sessionId: string;
  turnId: number;
  requestId: string;
  kind: string;
  title: string;
  body: string;
  expiresAt: Date;
}

export class StorageService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private cacheKey(namespace: string, key: string) { return `cache:${namespace}:${key}`; }

  async getCache(namespace: string, key: string) {
    const cache = await this.db.cacheEntry.findUnique({ where: { key: this.cacheKey(namespace, key) } });
    if (!cache) return null;
    if (cache.expiresAt && cache.expiresAt <= new Date()) {
      await this.db.cacheEntry.delete({ where: { key: cache.key } }).catch(() => undefined);
      return null;
    }
    return JSON.parse(cache.value);
  }

  upsertCache(namespace: string, key: string, value: unknown, ttlSeconds = 3600) {
    const cacheKey = this.cacheKey(namespace, key);
    const expiresAt = ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000) : null;
    const serializedValue = JSON.stringify(value);
    return this.db.cacheEntry.upsert({
      where: { key: cacheKey },
      update: { value: serializedValue, expiresAt },
      create: { key: cacheKey, value: serializedValue, expiresAt },
    });
  }

  deleteCache(namespace: string, key: string) {
    return this.db.cacheEntry.delete({ where: { key: this.cacheKey(namespace, key) } }).catch(() => undefined);
  }

  getDemoLink(ticketKey: string) { return this.db.demoLink.findUnique({ where: { ticketKey } }); }
  upsertDemoLink(ticketKey: string, url: string) {
    return this.db.demoLink.upsert({ where: { ticketKey }, update: { url }, create: { ticketKey, url } });
  }
  deleteDemoLink(ticketKey: string) { return this.db.demoLink.delete({ where: { ticketKey } }); }

  getTicketDependencies() {
    return this.db.ticketDependency.findMany({ orderBy: [{ dependsOnKey: 'asc' }, { ticketKey: 'asc' }] });
  }

  upsertTicketDependency(ticketKey: string, dependsOnKey: string) {
    return this.db.ticketDependency.upsert({
      where: { ticketKey },
      update: { dependsOnKey },
      create: { ticketKey, dependsOnKey },
    });
  }

  async getTicketOrders(): Promise<Map<string, number>> {
    return new Map((await this.db.ticketOrder.findMany()).map((row) => [row.ticketKey, row.position]));
  }

  setTicketOrder(ticketKey: string, position: number) {
    return this.db.ticketOrder.upsert({ where: { ticketKey }, update: { position }, create: { ticketKey, position } });
  }

  deleteTicketOrder(ticketKey: string) {
    return this.db.ticketOrder.delete({ where: { ticketKey } }).catch(() => undefined);
  }

  deleteTicketDependency(ticketKey: string) {
    return this.db.ticketDependency.delete({ where: { ticketKey } }).catch(() => undefined);
  }

  async getSettings() {
    const settings = await this.db.appSettings.findMany();
    return settings.map((setting) => SENSITIVE_KEYS.has(setting.key)
      ? { ...setting, value: decrypt(setting.value) }
      : setting);
  }

  upsertSetting(key: string, value: string, description?: string) {
    const storedValue = SENSITIVE_KEYS.has(key) ? encrypt(value) : value;
    return this.db.appSettings.upsert({
      where: { key }, update: { value: storedValue, description },
      create: { key, value: storedValue, description },
    });
  }

  deleteSetting(key: string) {
    return this.db.appSettings.delete({ where: { key } }).catch(() => undefined);
  }

  getSprintSnapshots() {
    return this.db.sprintSnapshot.findMany({ orderBy: { startDate: 'desc' } });
  }

  getSprintSnapshot(sprintId: number) {
    return this.db.sprintSnapshot.findUnique({ where: { sprintId } });
  }

  upsertSprintSnapshot(data: {
    sprintId: number; name: string; state: string; startDate: Date; endDate: Date;
    result?: string | null; computedAt?: Date | null; lastError?: string | null;
  }) {
    const { sprintId, ...fields } = data;
    return this.db.sprintSnapshot.upsert({ where: { sprintId }, update: fields, create: { sprintId, ...fields } });
  }

  getSprintIssueEvents(sprintId: number) {
    return this.db.sprintIssueEvents.findUnique({ where: { sprintId } });
  }

  upsertSprintIssueEvents(sprintId: number, issues: string, fetchedAt: Date, labelPool?: string) {
    return this.db.sprintIssueEvents.upsert({
      where: { sprintId }, update: { issues, fetchedAt, labelPool }, create: { sprintId, issues, fetchedAt, labelPool },
    });
  }

  getQuickLinks() {
    return this.db.quickLink.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  }

  createQuickLink(data: { title: string; url: string; color: string; position?: number }) {
    return this.db.quickLink.create({ data: { ...data, position: data.position ?? 0 } });
  }

  deleteQuickLink(id: string) {
    return this.db.quickLink.delete({ where: { id } });
  }

  getMonitorTargets() {
    return this.db.monitorTarget.findMany({ orderBy: [{ name: 'asc' }, { createdAt: 'asc' }] });
  }

  countMonitorTargets() {
    return this.db.monitorTarget.count();
  }

  getMonitorTarget(id: string) {
    return this.db.monitorTarget.findUnique({ where: { id } });
  }

  createMonitorTarget(data: { name: string; url: string; expectedStatus: number; timeoutMs: number }) {
    return this.db.monitorTarget.create({ data });
  }

  updateMonitorTarget(id: string, data: { name: string; url: string; expectedStatus: number; timeoutMs: number }) {
    return this.db.monitorTarget.update({ where: { id }, data });
  }

  updateMonitorResult(id: string, data: {
    lastStatus: string;
    lastStatusCode?: number | null;
    lastLatencyMs: number;
    lastCheckedAt: Date;
    lastError?: string | null;
  }) {
    return this.db.monitorTarget.update({ where: { id }, data });
  }

  deleteMonitorTarget(id: string) {
    return this.db.monitorTarget.delete({ where: { id } });
  }

  async hasMasterPin() {
    const pin = await this.db.appSettings.findUnique({ where: { key: 'masterPin' } });
    return Boolean(pin?.value);
  }

  setMasterPin(pin: string) {
    const value = hashPin(pin);
    return this.db.appSettings.upsert({
      where: { key: 'masterPin' }, update: { value, description: 'Master Passcode PIN Hash' },
      create: { key: 'masterPin', value, description: 'Master Passcode PIN Hash' },
    });
  }

  async verifyMasterPin(pin: string) {
    const stored = await this.db.appSettings.findUnique({ where: { key: 'masterPin' } });
    return !stored?.value || verifyPin(pin, stored.value);
  }

  async changeMasterPin(oldPin: string, newPin: string) {
    if (!await this.verifyMasterPin(oldPin)) return false;
    await this.setMasterPin(newPin);
    return true;
  }

  async removeMasterPin(oldPin: string) {
    if (!await this.verifyMasterPin(oldPin)) return false;
    await this.db.appSettings.delete({ where: { key: 'masterPin' } }).catch(() => undefined);
    return true;
  }

  getOrchestratorRuns() {
    return this.db.orchestratorRun.findMany({ select: RUN_WITHOUT_LEDGER, orderBy: [{ ledgerUpdatedAt: 'desc' }, { key: 'asc' }] });
  }

  getOrchestratorRun(key: string) {
    return this.db.orchestratorRun.findUnique({ where: { key }, select: RUN_WITHOUT_LEDGER });
  }

  getOrchestratorRunWithLedger(key: string) {
    return this.db.orchestratorRun.findUnique({ where: { key } });
  }

  countLiveOrchestratorRuns(machine: string) {
    return this.db.orchestratorRun.count({ where: { machine, dismissedAt: null } });
  }

  async upsertOrchestratorRun(key: string, data: { title: string; stage: string; waiting: string; payload: string; ledgerUpdatedAt: Date; machine: string; ledgerRaw: string | null }) {
    const { machine, ...fields } = data;
    const updated = await this.db.orchestratorRun.updateMany({ where: { key, machine }, data: { ...fields, dismissedAt: null } });
    if (updated.count === 0) {
      try {
        return await this.db.orchestratorRun.create({ data: { key, ...data } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
    }
    return this.db.orchestratorRun.findUniqueOrThrow({ where: { key } });
  }

  async takeDismissedOrchestratorRun(key: string, data: { title: string; stage: string; waiting: string; payload: string; ledgerUpdatedAt: Date; machine: string; ledgerRaw: string | null }) {
    await this.db.orchestratorRun.updateMany({ where: { key, dismissedAt: { not: null } }, data: { ...data, handover: null, dismissedAt: null, activity: 'IDLE', activityDetail: null, activityEndedAt: null, lastEventAt: null, transcriptAt: null } });
    return this.db.orchestratorRun.findUniqueOrThrow({ where: { key } });
  }

  async changeOrchestratorRunOwner(key: string, expected: { machine: string; handover: string | null }, machine: string) {
    const moved = await this.db.orchestratorRun.updateMany({ where: { key, ...expected }, data: { machine, handover: null } });
    return moved.count === 1;
  }

  updateOrchestratorRun(key: string, data: {
    activity?: string;
    activityDetail?: string | null;
    activityEndedAt?: Date | null;
    lastEventAt?: Date;
    transcriptAt?: Date;
    dismissedAt?: Date | null;
    handover?: string | null;
  }) {
    return this.db.orchestratorRun.update({ where: { key }, data, select: RUN_WITHOUT_LEDGER });
  }

  getOrchestratorEvents(ticketKey: string, take: number) {
    return this.db.orchestratorEvent.findMany({ where: { ticketKey }, orderBy: { createdAt: 'desc' }, take });
  }

  async addOrchestratorEvent(ticketKey: string, kind: string, detail: string | null, keep: number) {
    const event = await this.db.orchestratorEvent.create({ data: { ticketKey, kind, detail } });
    const stale = await this.db.orchestratorEvent.findMany({
      where: { ticketKey }, orderBy: { createdAt: 'desc' }, skip: keep, select: { id: true },
    });
    if (stale.length > 0) {
      await this.db.orchestratorEvent.deleteMany({ where: { id: { in: stale.map((item) => item.id) } } });
    }
    return event;
  }

  getOrchestratorToolEvents(ticketKey: string, take: number) {
    return this.db.orchestratorToolEvent.findMany({ where: { ticketKey }, orderBy: { id: 'desc' }, take });
  }

  async addOrchestratorToolEvents(
    ticketKey: string,
    events: Array<{ kind: string; agentId: string; agentType: string | null; name: string; detail: string | null; at: Date }>,
    keep: number,
  ) {
    if (events.length === 0) return;
    await this.db.orchestratorToolEvent.createMany({ data: events.map((event) => ({ ticketKey, ...event })) });
    const oldestKept = await this.db.orchestratorToolEvent.findFirst({
      where: { ticketKey }, orderBy: { id: 'desc' }, skip: keep - 1, select: { id: true },
    });
    if (oldestKept) {
      await this.db.orchestratorToolEvent.deleteMany({ where: { ticketKey, id: { lt: oldestKept.id } } });
    }
  }

  getIngestTokens() {
    return this.db.ingestToken.findMany({ where: { revokedAt: null }, orderBy: { createdAt: 'asc' } });
  }

  countIngestTokens() {
    return this.db.ingestToken.count({ where: { revokedAt: null } });
  }

  createIngestToken(data: { name: string; prefix: string; tokenHash: string; machine: string }) {
    return this.db.ingestToken.create({ data });
  }

  findIngestToken(tokenHash: string) {
    return this.db.ingestToken.findFirst({ where: { tokenHash, revokedAt: null } });
  }

  touchIngestToken(id: string, lastUsedAt: Date) {
    return this.db.ingestToken.update({ where: { id }, data: { lastUsedAt } });
  }

  revokeIngestToken(id: string) {
    return this.db.ingestToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  getChatSessions(source: string | null, take: number) {
    return this.db.chatSession.findMany({
      where: source ? { source } : {}, orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }], take,
    });
  }

  getChatSession(id: string) {
    return this.db.chatSession.findUnique({ where: { id } });
  }

  getChatSessionsByIds(ids: string[]) {
    return this.db.chatSession.findMany({ where: { id: { in: ids } } });
  }

  getChatSessionsWithTicket(source: string, since: Date) {
    return this.db.chatSession.findMany({ where: { source, ticketKey: { not: null }, lastMessageAt: { gte: since } } });
  }

  getStaleChatSessions(before: Date) {
    return this.db.chatSession.findMany({ where: { status: 'running', lastDeltaAt: { lt: before } }, select: { id: true } });
  }

  createChatSession(data: {
    id: string; source: string; machine?: string; title: string; ticketKey: string | null; forkFrom?: string | null;
    messageCount?: number; startedAt: Date; lastMessageAt: Date; origin?: 'cron' | 'manual';
  }) {
    return this.db.chatSession.create({ data });
  }

  updateChatSession(id: string, data: {
    title?: string;
    ticketKey?: string | null;
    claudeSessionId?: string;
    status?: string;
    statusDetail?: string | null;
    messageCount?: number;
    startedAt?: Date;
    lastMessageAt?: Date;
    lastDeltaAt?: Date;
    options?: string | null;
  }) {
    return this.db.chatSession.update({ where: { id }, data });
  }

  async deleteChatSession(id: string) {
    const [, , , sessions] = await this.db.$transaction([
      this.db.chatMessage.deleteMany({ where: { sessionId: id } }),
      this.db.chatActivity.deleteMany({ where: { sessionId: id } }),
      this.db.chatInteraction.deleteMany({ where: { sessionId: id } }),
      this.db.chatSession.deleteMany({ where: { id } }),
    ]);
    return sessions.count > 0;
  }

  deleteChatMessages(sessionId: string) {
    return this.db.chatMessage.deleteMany({ where: { sessionId } });
  }

  createChatMessage(data: { sessionId: string; role: string; text: string; state: string; at: Date; options?: string | null }) {
    return this.db.chatMessage.create({ data });
  }

  deleteChatMessage(id: number) {
    return this.db.chatMessage.deleteMany({ where: { id } });
  }

  async deleteChatDraft(id: number) {
    const deleted = await this.db.chatMessage.deleteMany({ where: { id, state: 'draft' } });
    return deleted.count === 1;
  }

  /** Appends messages, drops the oldest beyond `keep` and returns how many the session has now. */
  async addChatMessages(sessionId: string, messages: Array<{ role: string; text: string; at: Date }>, keep: number) {
    if (messages.length > 0) {
      await this.db.chatMessage.createMany({ data: messages.map((message) => ({ sessionId, ...message })) });
    }
    return this.trimChatMessages(sessionId, keep);
  }

  async trimChatMessages(sessionId: string, keep: number) {
    const oldestKept = await this.db.chatMessage.findFirst({
      where: { sessionId }, orderBy: { id: 'desc' }, skip: keep - 1, select: { id: true },
    });
    if (oldestKept) {
      await this.db.chatMessage.deleteMany({ where: { sessionId, id: { lt: oldestKept.id } } });
      await this.deleteChatActivityBefore(sessionId, oldestKept.id);
    }
    return this.db.chatMessage.count({ where: { sessionId } });
  }

  countChatActivity(sessionId: string, turnId: number) {
    return this.db.chatActivity.count({ where: { sessionId, turnId } });
  }

  deleteChatActivityBefore(sessionId: string, turnId: number) {
    return this.db.chatActivity.deleteMany({ where: { sessionId, turnId: { lt: turnId } } });
  }

  upsertChatActivity(sessionId: string, turnId: number, events: ChatActivityInput[], maxRows: number, droppedId: string, at: Date) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "ChatSession" SET "id" = "id" WHERE "id" = ${sessionId}`;
      let seq = (await tx.chatActivity.aggregate({ where: { sessionId }, _max: { seq: true } }))._max.seq ?? 0;
      const known = new Map((await tx.chatActivity.findMany({
        where: { sessionId, turnId, eventId: { in: events.map((event) => event.eventId) } },
      })).map((row) => [row.eventId, row]));
      let used = await tx.chatActivity.count({ where: { sessionId, turnId, eventId: { not: droppedId } } });
      let accepted = 0;
      let dropped = 0;
      for (const event of events) {
        const row = known.get(event.eventId);
        if (!row) {
          if (used >= maxRows) {
            dropped += 1;
            continue;
          }
          used += 1;
          seq += 1;
          known.set(event.eventId, await tx.chatActivity.create({ data: { sessionId, turnId, ...event, seq } }));
        } else if (row.status !== 'running' && event.status === 'running') {
          accepted += 1;
          continue;
        } else {
          const next = {
            status: event.status,
            endedAt: event.endedAt ?? row.endedAt,
            label: event.label,
            summary: event.summary,
            detail: event.detail ?? row.detail,
          };
          const changed = next.status !== row.status || next.label !== row.label || next.summary !== row.summary
            || next.detail !== row.detail || next.endedAt?.getTime() !== row.endedAt?.getTime();
          if (changed) {
            seq += 1;
            known.set(event.eventId, await tx.chatActivity.update({ where: { id: row.id }, data: { ...next, seq } }));
          }
        }
        accepted += 1;
      }
      if (dropped > 0) {
        const before = known.get(droppedId) ?? await tx.chatActivity.findUnique({
          where: { sessionId_turnId_eventId: { sessionId, turnId, eventId: droppedId } },
        });
        const total = Number(before?.summary ?? 0) + dropped;
        const data = { label: `${total} steps not shown`, summary: String(total), status: 'ok', endedAt: at };
        seq += 1;
        if (before) await tx.chatActivity.update({ where: { id: before.id }, data: { ...data, seq } });
        else {
          await tx.chatActivity.create({
            data: { sessionId, turnId, eventId: droppedId, kind: 'note', agent: 'main', name: 'dropped', startedAt: at, ...data, seq },
          });
        }
      }
      return { accepted, dropped, seq };
    });
  }

  async getChatActivity(
    sessionId: string,
    filter: { afterSeq?: number | null; fromTurnId?: number | null; beforeTurnId?: number | null },
    take: number,
  ) {
    const turnId = {
      ...(filter.fromTurnId != null ? { gte: filter.fromTurnId } : {}),
      ...(filter.beforeTurnId != null ? { lt: filter.beforeTurnId } : {}),
    };
    const rows = await this.db.chatActivity.findMany({
      where: { sessionId, ...(filter.afterSeq != null ? { seq: { gt: filter.afterSeq } } : {}), turnId },
      select: {
        id: true, sessionId: true, turnId: true, eventId: true, parentId: true, kind: true, agent: true, name: true,
        label: true, summary: true, status: true, seq: true, startedAt: true, endedAt: true,
      },
      orderBy: [{ seq: 'asc' }, { id: 'asc' }],
      take,
    });
    const withDetail = new Set((await this.db.chatActivity.findMany({
      where: { id: { in: rows.map((row) => row.id) }, detail: { not: null } }, select: { id: true },
    })).map((row) => row.id));
    return rows.map((row) => ({ ...row, hasDetail: withDetail.has(row.id) }));
  }

  async getChatActivityDetail(sessionId: string, id: number) {
    return (await this.db.chatActivity.findFirst({ where: { id, sessionId }, select: { detail: true } }))?.detail ?? null;
  }

  closeRunningChatActivity(sessionId: string, turnId: number | null, status: string, endedAt: Date) {
    return this.db.$transaction(async (tx) => {
      const running = await tx.chatActivity.findMany({
        where: { sessionId, status: 'running', ...(turnId === null ? {} : { turnId }) }, select: { id: true },
      });
      if (running.length === 0) return 0;
      let seq = (await tx.chatActivity.aggregate({ where: { sessionId }, _max: { seq: true } }))._max.seq ?? 0;
      for (const row of running) {
        seq += 1;
        await tx.chatActivity.update({ where: { id: row.id }, data: { status, endedAt, seq } });
      }
      return running.length;
    });
  }

  async pruneChatActivity({ detailBefore, rowsBefore, maxRows }: { detailBefore: Date; rowsBefore: Date; maxRows: number }) {
    const cutDetail = await this.db.chatActivity.updateMany({
      where: { startedAt: { lt: detailBefore }, detail: { not: null } }, data: { detail: null },
    });
    const old = await this.db.chatActivity.deleteMany({ where: { startedAt: { lt: rowsBefore } } });
    let evicted = 0;
    for (;;) {
      const perMachine = await this.db.$queryRaw<Array<{ machine: string; rows: number | bigint }>>(Prisma.sql`
        SELECT COALESCE(s."machine", '') AS "machine", COUNT(*) AS "rows" FROM "ChatActivity" a
        LEFT JOIN "ChatSession" s ON s."id" = a."sessionId" GROUP BY COALESCE(s."machine", '')`);
      const counts = perMachine.map((row) => ({ machine: row.machine, rows: Number(row.rows) })).sort((a, b) => b.rows - a.rows);
      const excess = counts.reduce((sum, row) => sum + row.rows, 0) - maxRows;
      if (excess <= 0) break;
      const tied = counts.filter((row) => row.rows === counts[0].rows).length;
      const gap = counts[0].rows - (counts.find((row) => row.rows < counts[0].rows)?.rows ?? 0);
      const remove = Math.min(Math.ceil(excess / tied), gap);
      const removed = await this.db.$executeRaw(Prisma.sql`
        DELETE FROM "ChatActivity" WHERE "id" IN (
          SELECT a."id" FROM "ChatActivity" a LEFT JOIN "ChatSession" s ON s."id" = a."sessionId"
          WHERE COALESCE(s."machine", '') = ${counts[0].machine} ORDER BY a."id" ASC LIMIT ${remove})`);
      if (removed === 0) break;
      evicted += removed;
    }
    return { detailCleared: cutDetail.count, expired: old.count, evicted };
  }

  getChatMessage(id: number) {
    return this.db.chatMessage.findUnique({ where: { id } });
  }

  /** Ascending id. Without `afterId` the newest `take` (older than `beforeId` when given) are returned. */
  async getChatMessages(sessionId: string, cursor: { afterId?: number | null; beforeId?: number | null }, take: number) {
    const id = {
      ...(cursor.afterId != null ? { gt: cursor.afterId } : {}),
      ...(cursor.beforeId != null ? { lt: cursor.beforeId } : {}),
    };
    if (cursor.afterId != null) {
      return this.db.chatMessage.findMany({ where: { sessionId, id, state: { not: 'draft' } }, orderBy: { id: 'asc' }, take });
    }
    const newest = await this.db.chatMessage.findMany({ where: { sessionId, id, state: { not: 'draft' } }, orderBy: { id: 'desc' }, take });
    return newest.reverse();
  }

  countChatMessagesInState(sessionId: string, states: string[]) {
    return this.db.chatMessage.count({ where: { sessionId, state: { in: states } } });
  }

  async getQueuedChatMessages(machine: string, take: number) {
    const rows = await this.db.$queryRaw<Array<{ id: number | bigint; sessionId: string; text: string; options: string | null; origin: string }>>(Prisma.sql`
      SELECT m."id", m."sessionId", m."text", m."options", s."origin" FROM "ChatMessage" m
      JOIN "ChatSession" s ON s."id" = m."sessionId"
      WHERE m."state" = 'queued' AND m."role" = 'user' AND s."source" = 'dock' AND s."machine" = ${machine}
      ORDER BY m."id" ASC LIMIT ${take}`);
    return rows.map((row) => ({ id: Number(row.id), sessionId: row.sessionId, text: row.text, options: row.options, origin: row.origin }));
  }

  /** Cron sessions on a machine with a running turn (busy), and those with a user message queued and no running turn (waiting). */
  async countCronSlots(machine: string): Promise<{ busy: number; waiting: number }> {
    const [row] = await this.db.$queryRaw<Array<{ busy: number | bigint; waiting: number | bigint }>>(Prisma.sql`
      SELECT
        COUNT(DISTINCT CASE WHEN m."state" = 'taken' THEN s."id" END) AS "busy",
        COUNT(DISTINCT CASE WHEN m."state" = 'queued' AND m."role" = 'user'
          AND NOT EXISTS (SELECT 1 FROM "ChatMessage" t WHERE t."sessionId" = s."id" AND t."state" = 'taken') THEN s."id" END) AS "waiting"
      FROM "ChatSession" s JOIN "ChatMessage" m ON m."sessionId" = s."id"
      WHERE s."origin" = 'cron' AND s."source" = 'dock' AND s."machine" = ${machine} AND m."state" IN ('taken', 'queued')`);
    return { busy: Number(row?.busy ?? 0), waiting: Number(row?.waiting ?? 0) };
  }

  /** Ticket keys whose latest cron session, opened after `since`, ended without a reply and has nothing queued or running. */
  async getDeadCronStartKeys(since: Date): Promise<string[]> {
    const rows = await this.db.$queryRaw<Array<{ ticketKey: string }>>(Prisma.sql`
      SELECT s."ticketKey" AS "ticketKey"
      FROM "ChatSession" s
      WHERE s."origin" = 'cron' AND s."source" = 'dock' AND s."ticketKey" IS NOT NULL AND s."status" = 'idle' AND s."startedAt" >= ${since}
        AND s."startedAt" = (SELECT MAX(x."startedAt") FROM "ChatSession" x WHERE x."origin" = 'cron' AND x."ticketKey" = s."ticketKey")
        AND EXISTS (SELECT 1 FROM "ChatMessage" m WHERE m."sessionId" = s."id" AND m."role" = 'user')
        AND NOT EXISTS (SELECT 1 FROM "ChatMessage" m WHERE m."sessionId" = s."id" AND (m."role" <> 'user' OR m."state" IN ('queued', 'taken')))`);
    return rows.map((row) => row.ticketKey);
  }

  /** The state check is part of the write, so two bridges cannot take the same message. */
  async moveChatMessage(id: number, sessionId: string, from: string, to: string, extra: { takenAt?: Date } = {}) {
    const moved = await this.db.chatMessage.updateMany({ where: { id, sessionId, state: from }, data: { state: to, ...extra } });
    return moved.count === 1;
  }

  async getChatMessageIdsInState(sessionId: string, states: string[]) {
    return (await this.db.chatMessage.findMany({ where: { sessionId, state: { in: states } }, select: { id: true }, orderBy: { id: 'asc' } }))
      .map((row) => row.id);
  }

  getOpenChatMessage(sessionId: string) {
    return this.db.chatMessage.findFirst({ where: { sessionId, role: 'user', state: { in: ['queued', 'taken'] } }, orderBy: { id: 'asc' } });
  }

  getStaleChatDrafts(before: Date) {
    return this.db.chatMessage.findMany({ where: { state: 'draft', at: { lt: before } }, select: { id: true, sessionId: true } });
  }

  async getOverdueChatSessions(takenBefore: Date) {
    const rows = await this.db.chatMessage.findMany({
      where: { state: 'taken', takenAt: { lt: takenBefore } }, select: { sessionId: true }, distinct: ['sessionId'],
    });
    return rows.map((row) => ({ id: row.sessionId }));
  }

  async getQuietChatTurns(silentBefore: Date, stopBefore: Date) {
    const running = await this.db.chatSession.findMany({
      where: { status: 'running', lastDeltaAt: { lt: silentBefore } }, select: { id: true },
    });
    const silent = running.length === 0 ? [] : await this.db.chatMessage.findMany({
      where: { state: 'taken', takenAt: { not: null }, sessionId: { in: running.map((row) => row.id) } }, select: { id: true, sessionId: true },
    });
    const unstopped = await this.db.chatMessage.findMany({
      where: { state: 'taken', takenAt: { not: null }, stopRequestedAt: { lt: stopBefore } }, select: { id: true, sessionId: true },
    });
    return {
      silent: silent.map((row) => ({ sessionId: row.sessionId, turnId: row.id })),
      unstopped: unstopped.map((row) => ({ sessionId: row.sessionId, turnId: row.id })),
    };
  }

  async requestChatStop(id: number, sessionId: string, at: Date) {
    const marked = await this.db.chatMessage.updateMany({ where: { id, sessionId, state: 'taken', stopRequestedAt: null }, data: { stopRequestedAt: at } });
    return marked.count === 1;
  }

  createChatInteraction(data: ChatInteractionInput, limits: { pending: number; perTurn: number }, now: Date) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "ChatSession" SET "id" = "id" WHERE "id" = ${data.sessionId}`;
      const known = await tx.chatInteraction.findUnique({
        where: { sessionId_turnId_requestId: { sessionId: data.sessionId, turnId: data.turnId, requestId: data.requestId } },
      });
      if (known) return { row: known, refused: null };
      await tx.chatInteraction.updateMany({
        where: { sessionId: data.sessionId, turnId: data.turnId, state: 'pending', expiresAt: { lt: now } }, data: { state: 'expired' },
      });
      const pending = await tx.chatInteraction.count({ where: { sessionId: data.sessionId, turnId: data.turnId, state: 'pending' } });
      if (pending >= limits.pending) return { row: null, refused: 'pending' as const };
      const total = await tx.chatInteraction.count({ where: { sessionId: data.sessionId, turnId: data.turnId } });
      if (total >= limits.perTurn) return { row: null, refused: 'turn' as const };
      return { row: await tx.chatInteraction.create({ data }), refused: null };
    });
  }

  getChatInteraction(id: number) {
    return this.db.chatInteraction.findUnique({ where: { id } });
  }

  async answerChatInteraction(id: number, answer: string, at: Date) {
    const answered = await this.db.chatInteraction.updateMany({
      where: { id, state: 'pending', expiresAt: { gte: at } }, data: { state: 'answered', answer, answeredAt: at },
    });
    return answered.count === 1;
  }

  expireChatInteractions(sessionId: string | null, now: Date) {
    return this.db.chatInteraction.updateMany({
      where: { ...(sessionId === null ? {} : { sessionId }), state: 'pending', expiresAt: { lt: now } }, data: { state: 'expired' },
    });
  }

  cancelChatInteractions(sessionId: string, turnId: number | null) {
    return this.db.chatInteraction.updateMany({
      where: { sessionId, state: 'pending', ...(turnId === null ? {} : { turnId }) }, data: { state: 'cancelled' },
    });
  }

  cancelChatInteractionsByRequest(sessionId: string, turnId: number, requestIds: string[]) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "ChatSession" SET "id" = "id" WHERE "id" = ${sessionId}`;
      const cancelled = await tx.chatInteraction.updateMany({
        where: { sessionId, turnId, requestId: { in: requestIds }, state: 'pending' }, data: { state: 'cancelled' },
      });
      return cancelled.count;
    });
  }

  getPendingChatInteractions(sessionId: string, take: number, notBefore?: Date) {
    return this.db.chatInteraction.findMany({
      where: { sessionId, state: 'pending', ...(notBefore ? { expiresAt: { gte: notBefore } } : {}) }, orderBy: { id: 'asc' }, take,
    });
  }

  getSettledChatInteractions(sessionId: string, turnId: number, take: number) {
    return this.db.chatInteraction.findMany({
      where: { sessionId, turnId, state: { in: ['answered', 'expired', 'cancelled'] } }, orderBy: { id: 'desc' }, take,
    });
  }

  async hasOverdueChatInteractions(sessionId: string, now: Date) {
    const row = await this.db.chatInteraction.findFirst({ where: { sessionId, state: 'pending', expiresAt: { lt: now } }, select: { id: true } });
    return row !== null;
  }

  getUndeliveredChatInteractions(sessionId: string, turnId: number) {
    return this.db.chatInteraction.findMany({
      where: { sessionId, turnId, state: { in: ['answered', 'expired'] }, deliveredAt: null }, orderBy: { id: 'asc' },
    });
  }

  markChatInteractionsDelivered(sessionId: string, turnId: number, requestIds: string[], at: Date) {
    return this.db.chatInteraction.updateMany({
      where: { sessionId, turnId, requestId: { in: requestIds }, state: { in: ['answered', 'expired'] }, deliveredAt: null }, data: { deliveredAt: at },
    });
  }

  async getWaitingChatSessionIds(sessionIds: string[], now: Date) {
    if (sessionIds.length === 0) return new Set<string>();
    const rows = await this.db.chatInteraction.findMany({
      where: { sessionId: { in: sessionIds }, state: 'pending', expiresAt: { gte: now } }, select: { sessionId: true }, distinct: ['sessionId'],
    });
    return new Set(rows.map((row) => row.sessionId));
  }

  async pruneChatInteractions({ before, maxRows }: { before: Date; maxRows: number }) {
    const old = await this.db.chatInteraction.deleteMany({ where: { createdAt: { lt: before } } });
    const newest = await this.db.chatInteraction.findFirst({ orderBy: { id: 'desc' }, skip: maxRows - 1, select: { id: true } });
    const over = newest ? await this.db.chatInteraction.deleteMany({ where: { id: { lt: newest.id } } }) : { count: 0 };
    return { expired: old.count, evicted: over.count };
  }

  getChatMachineInfo(machine: string) {
    return this.db.chatMachineInfo.findUnique({ where: { machine } });
  }

  upsertChatMachineInfo(machine: string, data: { caps?: string; catalog?: string; catalogHash?: string }) {
    return this.db.chatMachineInfo.upsert({ where: { machine }, update: data, create: { machine, ...data } });
  }

  moveChatMessages(sessionId: string, from: string, to: string) {
    return this.db.chatMessage.updateMany({ where: { sessionId, state: from }, data: { state: to } });
  }

  getNewestChatMessage(sessionId: string, role: string) {
    return this.db.chatMessage.findFirst({ where: { sessionId, role }, orderBy: { id: 'desc' } });
  }

  /** Case-insensitive for ASCII. Prisma's `contains` leaves % and _ as wildcards on sqlite, so the pattern is escaped here. */
  async searchChatMessages(query: string, take: number) {
    const pattern = `%${query.replace(/[!%_]/g, '!$&')}%`;
    const found = await this.db.$queryRaw<Array<{ id: number | bigint }>>(Prisma.sql`
      SELECT "id" FROM "ChatMessage" WHERE "text" LIKE ${pattern} ESCAPE '!' AND "state" <> 'draft'
      ORDER BY "at" DESC, "id" DESC LIMIT ${take}`);
    const ids = found.map((row) => Number(row.id));
    const rows = await this.db.chatMessage.findMany({ where: { id: { in: ids } } });
    return rows.sort((first, second) => ids.indexOf(first.id) - ids.indexOf(second.id));
  }

  /** One query for the whole list: the start of each session's newest user or assistant message. */
  async getChatLastTexts(sessionIds: string[], length: number) {
    if (sessionIds.length === 0) return new Map<string, string>();
    const rows = await this.db.$queryRaw<Array<{ sessionId: string; text: string }>>(Prisma.sql`
      SELECT "sessionId", substr("text", 1, ${length}) AS "text" FROM "ChatMessage"
      WHERE "id" IN (
        SELECT MAX("id") FROM "ChatMessage"
        WHERE "sessionId" IN (${Prisma.join(sessionIds)}) AND "role" IN ('user', 'assistant') AND "state" <> 'draft'
        GROUP BY "sessionId"
      )`);
    return new Map(rows.map((row) => [row.sessionId, row.text]));
  }

  getRepositories() { return this.db.monitoredRepository.findMany(); }
  createRepository(data: { owner: string; name: string; webhookSecret?: string }) {
    return this.db.monitoredRepository.create({ data });
  }
  getTicketCache(key: string) { return this.db.ticketCache.findUnique({ where: { key } }); }
  getAllTicketCache() { return this.db.ticketCache.findMany(); }
  upsertTicketCache(data: { key: string; summary: string; description?: string; status: string; assignee?: string; reporter?: string; priority?: string }) {
    return this.db.ticketCache.upsert({ where: { key: data.key }, update: data, create: data });
  }
  getPullRequestCache(repository: string, number: number) {
    return this.db.pullRequestCache.findUnique({ where: { repository_number: { repository, number } } });
  }
  getAllPullRequestCache() { return this.db.pullRequestCache.findMany(); }
  upsertPullRequestCache(data: { number: number; title: string; description?: string; state: string; url: string; author: string; repository: string; mergedAt?: Date | null }) {
    const where = { repository_number: { repository: data.repository, number: data.number } };
    return this.db.pullRequestCache.upsert({ where, update: data, create: data });
  }
}
