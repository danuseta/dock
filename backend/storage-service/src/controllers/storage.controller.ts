import { Request, Response, NextFunction } from 'express';
import { StorageService } from '../services/storage.service';
import { ValidationError } from '../utils/errors';

export class StorageController {
  private service: StorageService;

  constructor() {
    this.service = new StorageService();
  }

  getDemoLink = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ticketKey } = req.params;
      const link = await this.service.getDemoLink(ticketKey);
      res.json({ success: true, data: link });
    } catch (error) {
      next(error);
    }
  };

  upsertDemoLink = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ticketKey, url } = req.body;
      if (!ticketKey || !url) {
        throw new ValidationError('ticketKey and url are required');
      }
      const link = await this.service.upsertDemoLink(ticketKey, url);
      res.status(201).json({ success: true, data: link });
    } catch (error) {
      next(error);
    }
  };

  deleteDemoLink = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ticketKey } = req.params;
      await this.service.deleteDemoLink(ticketKey);
      res.json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
      next(error);
    }
  };

  getSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const settings = await this.service.getSettings();
      res.json({ success: true, data: settings });
    } catch (error) {
      next(error);
    }
  };

  updateSetting = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { key, value, description } = req.body;
      if (!key || value === undefined) {
        throw new ValidationError('Key is required');
      }
      const setting = await this.service.upsertSetting(key, value, description);
      res.json({ success: true, data: setting });
    } catch (error) {
      next(error);
    }
  };

  getRepositories = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repos = await this.service.getRepositories();
      res.json({ success: true, data: repos });
    } catch (error) {
      next(error);
    }
  };

  createRepository = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { owner, name, webhookSecret } = req.body;
      if (!owner || !name) {
        throw new ValidationError('Owner and name are required');
      }
      const repo = await this.service.createRepository({ owner, name, webhookSecret });
      res.status(201).json({ success: true, data: repo });
    } catch (error) {
      next(error);
    }
  };

  getJiraCache = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { key } = req.query;
      if (key) {
        const ticket = await this.service.getTicketCache(key as string);
        res.json({ success: true, data: ticket });
      } else {
        const tickets = await this.service.getAllTicketCache();
        res.json({ success: true, data: tickets });
      }
    } catch (error) {
      next(error);
    }
  };

  updateJiraCache = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.body.key && req.body.data !== undefined) {
        const cache = await this.service.upsertCache('jira', req.body.key, req.body.data, req.body.ttl);
        return res.json({ success: true, data: cache.value });
      }
      const { key, summary, description, status, assignee, reporter, priority } = req.body;
      if (!key || !summary || !status) {
        // Fallback gracefully without throwing unhandled ValidationError
        return res.json({ success: true, message: 'Ignored incomplete Jira cache payload' });
      }
      const ticket = await this.service.upsertTicketCache({
        key, summary, description, status, assignee, reporter, priority
      });
      res.json({ success: true, data: ticket });
    } catch (error) {
      // Return success to prevent breaking client synchronization
      res.json({ success: false, message: 'Failed to process Jira cache update' });
    }
  };

  getJiraGenericCache = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const value = await this.service.getCache('jira', req.params.key);
      res.json({ success: true, data: value });
    } catch (error) {
      next(error);
    }
  };

  getGithubCache = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { repository, number } = req.query;
      if (repository && number) {
        const pr = await this.service.getPullRequestCache(repository as string, parseInt(number as string, 10));
        res.json({ success: true, data: pr });
      } else {
        const prs = await this.service.getAllPullRequestCache();
        res.json({ success: true, data: prs });
      }
    } catch (error) {
      next(error);
    }
  };

  updateGithubCache = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.body.key && req.body.data !== undefined) {
        const cache = await this.service.upsertCache('github', req.body.key, req.body.data, req.body.ttl);
        return res.json({ success: true, data: cache.value });
      }
      const { number, title, description, state, url, author, repository, mergedAt } = req.body;
      if (!number || !title || !state || !url || !author || !repository) {
        // Fallback gracefully without throwing unhandled ValidationError
        return res.json({ success: true, message: 'Ignored incomplete GitHub cache payload' });
      }
      const pr = await this.service.upsertPullRequestCache({
        number, title, description, state, url, author, repository, mergedAt: mergedAt ? new Date(mergedAt) : null
      });
      res.json({ success: true, data: pr });
    } catch (error) {
      // Return success to prevent breaking client synchronization
      res.json({ success: false, message: 'Failed to process GitHub cache update' });
    }
  };

  getGithubGenericCache = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const value = await this.service.getCache('github', req.params.key);
      res.json({ success: true, data: value });
    } catch (error) {
      next(error);
    }
  };

  getPinStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const hasPin = await this.service.hasMasterPin();
      res.json({ success: true, data: { hasPin } });
    } catch (error) {
      next(error);
    }
  };

  setPin = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { pin } = req.body;
      if (!/^\d{4,6}$/.test(String(pin || ''))) {
        throw new ValidationError('PIN must contain 4 to 6 digits');
      }
      await this.service.setMasterPin(pin);
      res.json({ success: true, message: 'Master PIN set successfully' });
    } catch (error) {
      next(error);
    }
  };

  verifyPin = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { pin } = req.body;
      if (!pin) throw new ValidationError('PIN is required');
      const valid = await this.service.verifyMasterPin(pin);
      res.json({ success: true, data: { valid } });
    } catch (error) {
      next(error);
    }
  };

  changePin = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { oldPin, newPin } = req.body;
      if (!/^\d{4,6}$/.test(String(oldPin || '')) || !/^\d{4,6}$/.test(String(newPin || ''))) {
        throw new ValidationError('Current PIN and new PIN must contain 4 to 6 digits');
      }
      const success = await this.service.changeMasterPin(oldPin, newPin);
      if (!success) {
        throw new ValidationError('Current PIN is incorrect');
      }
      res.json({ success: true, message: 'Master PIN changed successfully' });
    } catch (error) {
      next(error);
    }
  };

  removePin = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { oldPin } = req.body;
      if (!/^\d{4,6}$/.test(String(oldPin || ''))) {
        throw new ValidationError('Current PIN is required');
      }
      const success = await this.service.removeMasterPin(oldPin);
      if (!success) {
        throw new ValidationError('Current PIN is incorrect');
      }
      res.json({ success: true, message: 'Master PIN removed' });
    } catch (error) {
      next(error);
    }
  };
}
