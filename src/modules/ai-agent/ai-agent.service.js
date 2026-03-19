import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createToolCallingAgent, AgentExecutor } from "langchain/agents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import * as TrackingService from '../tracking/tracking.service.js';
import * as LogisticsService from '../logistics/logistics.service.js';

const getTrackingLogsTool = tool(
  async ({ packageId }) => {
    try {
      const logs = await TrackingService.getLogs(packageId);
      return JSON.stringify(logs);
    } catch (e) {
      return `Error obteniendo logs: ${e.message}`;
    }
  },
  {
    name: "get_tracking_logs",
    description: "Obtiene el historial de ubicaciones y estados (logs) de un paquete específico dado su ID principal (ej. TRK-...).",
    schema: z.object({
      packageId: z.string().describe("El ID único del paquete a consultar (ej. TRK-...)"),
    }),
  }
);

const getRouteInfoTool = tool(
  async ({ routeId }) => {
    try {
      const route = await LogisticsService.getRoute(routeId);
      return JSON.stringify(route);
    } catch (e) {
      return `Error obteniendo la ruta: ${e.message}`;
    }
  },
  {
    name: "get_route_info",
    description: "Obtiene los detalles de una ruta de transporte y los paquetes asignados a ella dado su ID.",
    schema: z.object({
      routeId: z.string().uuid().describe("El ID (UUID) de la ruta de transporte a consultar"),
    }),
  }
);

const tools = [getTrackingLogsTool, getRouteInfoTool];

/**
 * Factory paramétrico para inicializar el LLM.
 * Permite cambiar de proveedor fácilmente modificando el archivo .env.
 */
const getLLM = () => {
  const provider = process.env.LLM_PROVIDER || 'openai';

  switch (provider.toLowerCase()) {
    case 'openai':
      return new ChatOpenAI({
        modelName: process.env.LLM_MODEL_NAME || "gpt-4o-mini",
        temperature: 0,
      });

    // Aquí puedes agregar fácilmente otros proveedores de LangChain en el futuro:
    // case 'anthropic':
    //   import { ChatAnthropic } from "@langchain/anthropic";
    //   return new ChatAnthropic({ modelName: process.env.LLM_MODEL_NAME || "claude-3-haiku-20240307", temperature: 0 });
    // case 'google':
    //   import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
    //   return new ChatGoogleGenerativeAI({ modelName: process.env.LLM_MODEL_NAME || "gemini-1.5-flash", temperature: 0 });

    default:
      console.warn(`[AI Agent] Proveedor '${provider}' no soportado explícitamente. Usando OpenAI por defecto.`);
      return new ChatOpenAI({
        modelName: "gpt-4o-mini",
        temperature: 0,
      });
  }
};

const llm = getLLM();

const prompt = ChatPromptTemplate.fromMessages([
  ["system", "Eres un asistente logístico experto. Tienes acceso a herramientas para consultar el historial de paquetes (tracking) y el estado de las rutas de entrega. Ayuda al usuario con sus consultas de forma clara y concisa basándote en la información estricta devuelta por tus herramientas."],
  ["human", "{input}"],
  ["placeholder", "{agent_scratchpad}"],
]);

export const processChatMessage = async (message) => {
  const agent = createToolCallingAgent({
    llm,
    tools,
    prompt,
  });

  const agentExecutor = new AgentExecutor({
    agent,
    tools,
  });

  const result = await agentExecutor.invoke({
    input: message,
  });

  return result.output;
};