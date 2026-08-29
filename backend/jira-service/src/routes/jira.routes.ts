import { Router } from 'express';
import { JiraController } from '../controllers/jira.controller';

const router = Router();
const controller = new JiraController();

router.get('/tickets', controller.getTickets.bind(controller));
router.get('/tickets/:key', controller.getTicketDetails.bind(controller));
router.post('/tickets/refresh', controller.refreshTickets.bind(controller));
router.post('/validate', controller.validateCredentials.bind(controller));

export default router;
