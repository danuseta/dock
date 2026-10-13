import { prisma } from './client';

export interface AttachmentRow {
  id: string;
  sessionId: string;
  messageId: number | null;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  state: string;
  createdAt: Date;
  fetchedAt: Date | null;
}

export type AttachmentChange = Partial<Pick<AttachmentRow, 'messageId' | 'state' | 'fetchedAt'>>;

export interface ChatAttachmentStore {
  create(row: AttachmentRow): Promise<AttachmentRow>;
  get(id: string): Promise<AttachmentRow | null>;
  getMany(ids: string[]): Promise<AttachmentRow[]>;
  forMessages(messageIds: number[]): Promise<AttachmentRow[]>;
  countBySessionState(sessionId: string, state: string): Promise<number>;
  update(id: string, data: AttachmentChange): Promise<void>;
  claim(sessionId: string, ids: string[], messageId: number): Promise<number>;
  release(messageId: number): Promise<void>;
  remove(id: string): Promise<void>;
  removeUploaded(id: string): Promise<boolean>;
  purgeDeleted(before: Date): Promise<void>;
  forSession(sessionId: string): Promise<AttachmentRow[]>;
  live(): Promise<AttachmentRow[]>;
  removeSession(sessionId: string): Promise<void>;
}

export interface ChatSessionLookup {
  session(id: string): Promise<{ id: string; source: string; machine: string } | null>;
  message(id: number): Promise<{ id: number; sessionId: string; state: string } | null>;
}

interface AttachmentDelegate {
  create(args: { data: AttachmentRow }): Promise<AttachmentRow>;
  findUnique(args: { where: { id: string } }): Promise<AttachmentRow | null>;
  findMany(args: { where?: object; orderBy?: object }): Promise<AttachmentRow[]>;
  count(args: { where: object }): Promise<number>;
  update(args: { where: { id: string }; data: AttachmentChange }): Promise<unknown>;
  updateMany(args: { where: object; data: object }): Promise<{ count: number }>;
  deleteMany(args: { where: object }): Promise<{ count: number }>;
}

interface LookupClient {
  chatSession: { findUnique(args: { where: { id: string } }): Promise<{ id: string; source: string; machine: string } | null> };
  chatMessage: { findUnique(args: { where: { id: number } }): Promise<{ id: number; sessionId: string; state: string } | null> };
}

const attachments = () => (prisma as unknown as { chatAttachment: AttachmentDelegate }).chatAttachment;

export const prismaChatAttachmentStore: ChatAttachmentStore = {
  create: (row) => attachments().create({ data: row }),
  get: (id) => attachments().findUnique({ where: { id } }),
  getMany: (ids) => attachments().findMany({ where: { id: { in: ids } } }),
  forMessages: (messageIds) => attachments().findMany({ where: { messageId: { in: messageIds } }, orderBy: { createdAt: 'asc' } }),
  countBySessionState: (sessionId, state) => attachments().count({ where: { sessionId, state } }),
  update: async (id, data) => { await attachments().update({ where: { id }, data }); },
  claim: async (sessionId, ids, messageId) => (await attachments().updateMany({
    where: { id: { in: ids }, sessionId, state: 'uploaded' }, data: { messageId, state: 'attached' },
  })).count,
  release: async (messageId) => {
    await attachments().updateMany({ where: { messageId, state: 'attached' }, data: { messageId: null, state: 'uploaded' } });
  },
  remove: async (id) => { await attachments().deleteMany({ where: { id } }); },
  removeUploaded: async (id) => (await attachments().deleteMany({ where: { id, state: 'uploaded' } })).count === 1,
  purgeDeleted: async (before) => { await attachments().deleteMany({ where: { state: 'deleted', createdAt: { lt: before } } }); },
  forSession: (sessionId) => attachments().findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } }),
  live: () => attachments().findMany({ where: { state: { not: 'deleted' } }, orderBy: { createdAt: 'asc' } }),
  removeSession: async (sessionId) => { await attachments().deleteMany({ where: { sessionId } }); },
};

export const prismaChatSessionLookup: ChatSessionLookup = {
  session: (id) => (prisma as unknown as LookupClient).chatSession.findUnique({ where: { id } }),
  message: (id) => (prisma as unknown as LookupClient).chatMessage.findUnique({ where: { id } }),
};
