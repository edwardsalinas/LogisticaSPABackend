import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.GOOGLE_API_KEY;
const URL = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

import fs from 'fs';

async function checkApi() {
    try {
        console.log(`Checking API at: ${URL.replace(API_KEY, 'HIDDEN_KEY')}`);
        const response = await fetch(URL);
        const data = await response.json();

        if (!response.ok) {
            console.error('API Error Status:', response.status);
            fs.writeFileSync('available_models.txt', `Error: ${response.status}\n${JSON.stringify(data, null, 2)}`);
        } else {
            const models = data.models.map(m => m.name);
            console.log('Success! Found models:', models.length);
            fs.writeFileSync('available_models.txt', models.join('\n'));
        }
    } catch (error) {
        console.error('Fetch Error:', error);
        fs.writeFileSync('available_models.txt', `Fetch Error: ${error.message}`);
    }
}

checkApi();
