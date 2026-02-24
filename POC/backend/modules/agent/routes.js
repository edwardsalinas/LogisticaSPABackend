import express from 'express';
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";

const router = express.Router();

// --- MOCK DATABASE ---
const MOCK_INVENTORY = [
    { id: 1, name: 'Laptops Dell Latitude', stock: 150, location: 'Bodega A' },
    { id: 2, name: 'Monitores Samsung 24"', stock: 45, location: 'Bodega B' },
    { id: 3, name: 'Teclados Mecánicos', stock: 300, location: 'Bodega A' }
];

// --- TOOL DEFINITION ---
const inventoryTool = new DynamicStructuredTool({
    name: "search_inventory",
    description: "Search for products in inventory by name to see stock and location.",
    schema: z.object({
        query: z.string().describe("Product name to search for"),
    }),
    func: async ({ query }) => {
        console.log(`[Tool] Searching inventory for: ${query} `);
        const items = MOCK_INVENTORY.filter(i =>
            i.name.toLowerCase().includes(query.toLowerCase())
        );
        if (items.length === 0) return "No products found with that name.";
        return JSON.stringify(items);
    },
});

const tools = [inventoryTool];

// --- CHAT ENDPOINT ---
router.post('/query', async (req, res) => {
    const { message } = req.body;
    console.log(`[Agent] Received: "${message}"`);

    if (!process.env.GOOGLE_API_KEY) {
        return res.json({
            role: 'assistant',
            content: "⚠️ Config Error: GOOGLE_API_KEY is missing in .env",
            model: 'Error'
        });
    }

    try {
        // 1. Initialize Gemini Model
        const llm = new ChatGoogleGenerativeAI({
            model: "gemini-flash-latest",
            maxOutputTokens: 2048,
            apiKey: process.env.GOOGLE_API_KEY
        });

        // 2. Bind Tools
        const llmWithTools = llm.bindTools(tools);

        // 3. Conversation History (Simplified for POC)
        const messages = [
            new SystemMessage("You are a helpful logistics assistant. Use the search_inventory tool to check stock when asked."),
            new HumanMessage(message)
        ];

        // 4. Agent Loop: Iterate until no tool calls or max limit
        let aiMsg = await llmWithTools.invoke(messages);
        messages.push(aiMsg);

        let iterations = 0;
        const MAX_ITERATIONS = 5;

        while (aiMsg.tool_calls && aiMsg.tool_calls.length > 0 && iterations < MAX_ITERATIONS) {
            console.log(`[Agent] Tool Calls Requested: ${aiMsg.tool_calls.length} (Iter: ${iterations + 1})`);

            for (const toolCall of aiMsg.tool_calls) {
                if (toolCall.name === "search_inventory") {
                    const toolResult = await inventoryTool.func(toolCall.args);
                    messages.push(new ToolMessage({
                        tool_call_id: toolCall.id,
                        name: toolCall.name,
                        content: toolResult
                    }));
                }
            }

            // Get next response from Agent
            aiMsg = await llmWithTools.invoke(messages);
            messages.push(aiMsg);
            iterations++;
        }

        // 5. Final Response
        const content = typeof aiMsg.content === 'string' ? aiMsg.content : JSON.stringify(aiMsg.content);
        return res.json({
            role: 'assistant',
            content: content || "I processed your request but have no text response.",
            model: 'Gemini 1.5 Flash (Real)'
        });



    } catch (error) {
        console.error("Agent Error:", error);
        return res.status(500).json({
            error: "Agent Processing Failed",
            details: error.message
        });
    }
});

export default router;
