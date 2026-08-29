import { Request, Response } from 'express';
import { discordService } from '../services/discord.service';

export const sendSummary = async (req: Request, res: Response) => {
  try {
    const { ticket, prs, demoUrl, webhookUrl, customMessage, threadId, threadName } = req.body;
    
    if (!webhookUrl) {
      return res.status(400).json({ error: 'webhookUrl is required' });
    }
    
    await discordService.sendSummary({ ticket, prs, demoUrl }, webhookUrl, { customMessage, threadId, threadName });
    res.status(200).json({ success: true, message: 'Message sent successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send message to Discord' });
  }
};

export const validateWebhook = async (req: Request, res: Response) => {
  try {
    const { webhookUrl } = req.body;
    
    if (!webhookUrl) {
      return res.status(400).json({ error: 'webhookUrl is required' });
    }
    
    const isValid = await discordService.validateWebhook(webhookUrl);
    
    if (isValid) {
      res.status(200).json({ valid: true });
    } else {
      res.status(400).json({ valid: false, error: 'Invalid webhook URL' });
    }
  } catch (error) {
    res.status(500).json({ valid: false, error: 'Internal server error' });
  }
};
