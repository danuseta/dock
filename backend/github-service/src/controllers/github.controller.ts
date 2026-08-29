import { Request, Response } from 'express';
import { GitHubService } from '../services/github.service';

const githubService = new GitHubService();

export class GitHubController {
    
    private static extractPAT(req: Request): string {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new Error('Missing or invalid Authorization header');
        }
        return authHeader.split(' ')[1];
    }

    private static extractRepos(req: Request): string[] {
        const repos = req.query.repos as string;
        if (!repos) return [];
        return repos.split(',').map(r => r.trim()).filter(Boolean);
    }

    public static async searchPRs(req: Request, res: Response) {
        try {
            const pat = GitHubController.extractPAT(req);
            const repos = GitHubController.extractRepos(req);
            const ticketKey = req.params.ticketKey;
            
            if (repos.length === 0) {
                return res.status(400).json({ error: 'repos query parameter is required' });
            }

            const data = await githubService.searchPRs(pat, repos, ticketKey);
            res.json({ data });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    public static async checkConflicts(req: Request, res: Response) {
        try {
            const pat = GitHubController.extractPAT(req);
            const { owner, repo, number } = req.params;

            const data = await githubService.checkConflicts(pat, owner, repo, parseInt(number, 10));
            res.json({ data });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    public static async getNeedsAttention(req: Request, res: Response) {
        try {
            const pat = GitHubController.extractPAT(req);
            const repos = GitHubController.extractRepos(req);
            
            if (repos.length === 0) {
                return res.status(400).json({ error: 'repos query parameter is required' });
            }

            const data = await githubService.getNeedsAttention(pat, repos);
            res.json({ data });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    public static async validateCredentials(req: Request, res: Response) {
        try {
            const pat = GitHubController.extractPAT(req);
            const data = await githubService.validateCredentials(pat);
            res.json({ valid: true, user: data.login });
        } catch (error: any) {
            res.status(401).json({ valid: false, error: error.message });
        }
    }

    public static async listRepositories(req: Request, res: Response) {
        try {
            const pat = GitHubController.extractPAT(req);
            const data = await githubService.listRepositories(pat);
            res.json({ data });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
}
