import { Router } from 'express';
import { StorageController } from '../controllers/storage.controller';

const router = Router();
const controller = new StorageController();

// Demo Links
router.get('/demo-links/:ticketKey', controller.getDemoLink);
router.post('/demo-links', controller.upsertDemoLink);
router.delete('/demo-links/:ticketKey', controller.deleteDemoLink);

// Settings
router.get('/settings', controller.getSettings);
router.post('/settings', controller.updateSetting);

// Repositories
router.get('/repositories', controller.getRepositories);
router.post('/repositories', controller.createRepository);

// Jira Cache
router.get('/cache/jira', controller.getJiraCache);
router.get('/cache/jira/:key', controller.getJiraGenericCache);
router.post('/cache/jira', controller.updateJiraCache);

// GitHub Cache
router.get('/cache/github', controller.getGithubCache);
router.get('/cache/github/:key', controller.getGithubGenericCache);
router.post('/cache/github', controller.updateGithubCache);

// PIN Security
router.get('/pin/status', controller.getPinStatus);
router.post('/pin/set', controller.setPin);
router.post('/pin/change', controller.changePin);
router.post('/pin/verify', controller.verifyPin);
router.delete('/pin', controller.removePin);

export default router;
