import { Router } from 'express';
import { GitHubController } from '../controllers/github.controller';

const router = Router();

router.get('/prs/:ticketKey', GitHubController.searchPRs);
router.get('/prs/conflicts/:owner/:repo/:number', GitHubController.checkConflicts);
router.get('/needs-attention', GitHubController.getNeedsAttention);
router.post('/validate', GitHubController.validateCredentials);
router.get('/repos', GitHubController.listRepositories);

export default router;
