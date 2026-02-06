
import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = "AIzaSyDLl4XpsrLbj9qn6MlH3ArF4HiZMd_wz7Y";

async function probe() {
    console.log(`--- STARTING PAID TIER PROBE (...wz7Y) ---`);
    const genAI = new GoogleGenerativeAI(apiKey);

    try {
        // 1. List Models (REST)
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();

        console.log(`\n✅ REST API SUCCESS. Models found: ${data.models?.length || 0}`);
        const models = data.models?.map((m: any) => m.name.replace('models/', '')) || [];

        const targets = ['gemini-3-flash-preview', 'gemini-embedding-001'];
        targets.forEach(t => {
            const found = models.includes(t);
            console.log(`${found ? '✅' : '❌'} ${t} is ${found ? 'AVAILABLE' : 'MISSING'}`);
        });

        console.log('\n--- ALL Gemini/Embedding Models ---');
        models.filter((m: string) => m.includes('gemini')).forEach((m: string) => console.log(` - ${m}`));

    } catch (err: any) {
        console.error(`❌ Probe Failed: ${err.message}`);
    }
}

probe();
