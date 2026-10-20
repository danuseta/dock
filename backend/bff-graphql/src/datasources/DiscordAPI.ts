import { describeDiscordError, DiscordService } from '../integrations/discord';
import { StorageAPI } from './StorageAPI';

export class DiscordAPI {
  constructor(
    private readonly discordService: Pick<DiscordService, 'sendSummary' | 'validateWebhook'> = new DiscordService(),
    private readonly storageAPI: Pick<StorageAPI, 'getSettings'> = new StorageAPI(),
  ) {}

  async sendSummary(payload: any) {
    try {
      if (!payload.webhookUrl) return false;
      await this.discordService.sendSummary(
        { ticket: payload.ticket, relatedTickets: payload.relatedTickets, prs: payload.prs, demoUrl: payload.demoUrl },
        payload.webhookUrl,
        { customMessage: payload.customMessage, messageTemplate: payload.messageTemplate, threadId: payload.threadId, threadName: payload.threadName },
      );
      return true;
    } catch (error) {
      console.error('[Discord] Send failed:', describeDiscordError(error));
      return false;
    }
  }

  /** Without a URL the saved webhook is tested, as Jira and GitHub test their saved credentials. */
  async validateDiscord(webhookUrl?: string) {
    try {
      const candidate = webhookUrl || (await this.storageAPI.getSettings()).discordWebhookUrl;
      if (!candidate || !await this.discordService.validateWebhook(candidate)) {
        return { success: false, message: 'Discord webhook validation failed' };
      }
      return { success: true, message: 'Discord webhook valid' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Discord webhook validation failed' };
    }
  }
}
