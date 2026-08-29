import axios, { AxiosError } from 'axios';
import { SummaryPayload, formatMessage } from '../templates/message.template';

export class DiscordService {
  private async delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async sendSummary(payload: SummaryPayload, webhookUrl: string, options?: { customMessage?: string, threadId?: string, threadName?: string }, retryCount = 0): Promise<void> {
    const message = options?.customMessage && options.customMessage.trim() !== '' ? options.customMessage : formatMessage(payload);
    
    let targetUrl = webhookUrl;
    if (options?.threadId && options.threadId.trim() !== '') {
      const separator = targetUrl.includes('?') ? '&' : '?';
      targetUrl = `${targetUrl}${separator}thread_id=${options.threadId.trim()}`;
    }

    const requestBody: any = { content: message };
    if (options?.threadName && options.threadName.trim() !== '' && (!options.threadId || options.threadId.trim() === '')) {
      requestBody.thread_name = options.threadName.trim();
    }

    try {
      await axios.post(targetUrl, requestBody);
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response?.status === 429 && retryCount < 3) {
          const retryAfter = error.response.headers['retry-after'] 
            ? parseInt(error.response.headers['retry-after']) * 1000
            : Math.pow(2, retryCount) * 1000;
            
          console.warn(`Rate limited. Retrying after ${retryAfter}ms (Attempt ${retryCount + 1})`);
          await this.delay(retryAfter);
          return this.sendSummary(payload, webhookUrl, options, retryCount + 1);
        }
      }
      console.error('Failed to send Discord message', error);
      throw error;
    }
  }

  async validateWebhook(webhookUrl: string): Promise<boolean> {
    try {
      // Dry-run/test logic: Send an empty or very basic message, or just GET if the webhook allows
      // Usually Discord webhooks can be fetched via GET to verify validity
      const response = await axios.get(webhookUrl);
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }
}

export const discordService = new DiscordService();
