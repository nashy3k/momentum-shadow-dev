import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

async function test() {
    try {
        console.log('Testing direct Google Generative AI SDK...');
        const result = await model.generateContent('Hello, say "Direct SDK is working!"');
        console.log('Response:', result.response.text());
    } catch (e: any) {
        console.error('Error:', e.message);
    }
}

test();
