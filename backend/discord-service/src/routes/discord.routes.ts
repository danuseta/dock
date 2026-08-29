import { Router } from 'express';
import { sendSummary, validateWebhook } from '../controllers/discord.controller';

const router = Router();

router.post('/send-summary', sendSummary);
router.post('/validate', validateWebhook);

export default router;
