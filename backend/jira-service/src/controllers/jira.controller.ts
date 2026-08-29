import { Request, Response } from 'express';
import { JiraService } from '../services/jira.service';

const jiraService = new JiraService();

export class JiraController {
  async getTickets(req: Request, res: Response) {
    try {
      const { domain, email, apitoken } = req.headers as { domain?: string, email?: string, apitoken?: string };
      if (!domain || !email || !apitoken) {
        return res.status(400).json({ error: 'Missing Jira credentials in headers (domain, email, apitoken)' });
      }

      const tickets = await jiraService.getAssignedTickets(domain, email, apitoken);
      res.json(tickets);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to fetch tickets' });
    }
  }

  async getTicketDetails(req: Request, res: Response) {
    try {
      const { domain, email, apitoken } = req.headers as { domain?: string, email?: string, apitoken?: string };
      const { key } = req.params;

      if (!domain || !email || !apitoken) {
        return res.status(400).json({ error: 'Missing Jira credentials in headers' });
      }

      const ticket = await jiraService.getTicketDetails(domain, email, apitoken, key);
      res.json(ticket);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to fetch ticket details' });
    }
  }

  async refreshTickets(req: Request, res: Response) {
    try {
      const { domain, email, apitoken } = req.headers as { domain?: string, email?: string, apitoken?: string };
      if (!domain || !email || !apitoken) {
        return res.status(400).json({ error: 'Missing Jira credentials in headers' });
      }

      const tickets = await jiraService.getAssignedTickets(domain, email, apitoken, true);
      res.json(tickets);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to refresh tickets' });
    }
  }

  async validateCredentials(req: Request, res: Response) {
    try {
      const { domain, email, apiToken } = req.body;
      if (!domain || !email || !apiToken) {
        return res.status(400).json({ error: 'Missing domain, email, or apiToken in body' });
      }

      console.log(`[Jira Service] Validating connection for domain: ${domain}, email: ${email}`);
      const user = await jiraService.validateCredentials(domain, email, apiToken);
      console.log(`[Jira Service] Connection successful for user: ${user?.displayName || email}`);
      res.json({ valid: true, user });
    } catch (error: any) {
      console.error('[Jira Service] Validation failed:', error.response?.status, error.response?.data || error.message);
      let errorMsg = error.response?.data?.errorMessages?.join(', ') || error.response?.data?.message || error.message || 'Invalid credentials';
      if (error.response?.status === 401) {
        errorMsg = 'Jira 401 Unauthorized: API Token or Email is incorrect. Check your Jira token.';
      } else if (error.response?.status === 404) {
        errorMsg = `Jira 404 Not Found: Could not locate Jira workspace at ${req.body.domain}.`;
      } else if (error.code === 'ENOTFOUND') {
        errorMsg = `Jira Domain Unreachable: Cannot resolve DNS for ${req.body.domain}.`;
      }
      res.status(error.response?.status || 400).json({ valid: false, error: errorMsg });
    }
  }
}
