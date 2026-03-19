import { Router } from 'express';
import * as AiAgentController from './ai-agent.controller.js';
import { requireAuth } from '../../shared/middlewares/auth.js';

const router = Router();
router.use(requireAuth);

router.post('/chat', AiAgentController.handleChat);

export default router;
