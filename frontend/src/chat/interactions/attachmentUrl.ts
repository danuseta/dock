import { apiOrigin } from '../../lib/apollo';

export const attachmentHref = (id: string): string => `${apiOrigin}/api/chat/attachments/${encodeURIComponent(id)}`;
