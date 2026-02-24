import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

async function logError(modelName, error) {
    const msg = `Error with ${modelName}: ${error.message}\nFull Error: ${JSON.stringify(error, null, 2)}\n\n`;
    console.error(msg);
    fs.appendFileSync('error_log.txt', msg);
}

async function listModels() {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    } catch (error) {
        // ignore setup error
    }

    try {
        console.log("Testing 'gemini-1.0-pro'...");
        const model1 = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });
        const result1 = await model1.generateContent("Hi");
        console.log("Success with gemini-1.0-pro:", result1.response.text());
    } catch (error) {
        await logError('gemini-1.0-pro', error);
    }

    try {
        console.log("Testing 'gemini-pro'...");
        const model3 = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result3 = await model3.generateContent("Hi");
        console.log("Success with gemini-pro:", result3.response.text());
    } catch (error) {
        await logError('gemini-pro', error);
    }

    try {
        console.log("Testing 'gemini-1.5-flash'...");
        const model2 = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result2 = await model2.generateContent("Hi");
        console.log("Success with gemini-1.5-flash:", result2.response.text());
    } catch (error) {
        await logError('gemini-1.5-flash', error);
    }
}

listModels();
