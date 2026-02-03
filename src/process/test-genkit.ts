import { genkit } from 'genkit';
import { googleAI, gemini15Flash } from '@genkit-ai/googleai';
import * as dotenv from 'dotenv';

dotenv.config();

const ai = genkit({
    plugins: [googleAI({ apiKey: process.env.GOOGLE_API_KEY || false })],
    model: gemini15Flash,
});

async function test() {
    try {
        console.log('Testing Gemini API...');
        const response = await ai.generate('Hello, say "Genkit is working!"');
        console.log('Response:', response.text);
    } catch (e: any) {
        console.error('Error:', e.message);
        if (e.details) console.error('Details:', JSON.stringify(e.details, null, 2));
    }
}

test();
