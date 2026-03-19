import * as AiAgentService from './ai-agent.service.js';

export const handleChat = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, message: "El campo 'message' es requerido" });
    }

    const response = await AiAgentService.processChatMessage(message);
    return res.status(200).json({ success: true, response });
  } catch (error) {
    console.error('[AI Agent Controler Error]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
