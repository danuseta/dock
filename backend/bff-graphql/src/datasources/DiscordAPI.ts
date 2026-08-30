import { DiscordService } from '../integrations/discord';

export class DiscordAPI {
  constructor(private readonly discordService = new DiscordService()) {}

  async sendSummary(payload: any) {
    try {
      if (!payload.webhookUrl) return false;
      await this.discordService.sendSummary(
        { ticket: payload.ticket, prs: payload.prs, demoUrl: payload.demoUrl },
        payload.webhookUrl,
        { customMessage: payload.customMessage, messageTemplate: payload.messageTemplate, threadId: payload.threadId, threadName: payload.threadName },
      );
      return true;
    } catch (error) {
      console.error('Discord API error:', error);
      return false;
    }
  }

  async validateDiscord(webhookUrl?: string) {
    try {
      if (!webhookUrl || !await this.discordService.validateWebhook(webhookUrl)) {
        return { success: false, message: 'Discord webhook validation failed' };
      }
      return { success: true, message: 'Discord webhook valid' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Discord webhook validation failed' };
    }
  }
}
