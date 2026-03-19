import { Router } from 'express';
import * as AiAgentController from './ai-agent.controller.js';
import { requireAuth } from '../iam/iam.middleware.js';

const router = Router();
router.use(requireAuth);

router.post('/chat', AiAgentController.handleChat);

export default router;
