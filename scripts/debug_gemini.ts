
import * as dotenv from 'dotenv';
import * as path from 'path';

// Force load .env from root
const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

const apiKey = process.env.GOOGLE_API_KEY;

if (!apiKey) {
    console.error('❌ GOOGLE_API_KEY not found in .env');
    process.exit(1);
}

console.log(`🔑 API Key loaded: ...${apiKey.slice(-4)}`);
console.log(`Node Environment: ${process.env.NODE_ENV || 'development'}`);

async function test() {
    console.log('--- STARTING MODEL LIST PROBE (REST API) ---\n');
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`❌ HTTP Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error(`   Body: ${text}`);
            return;
        }

        const data = await response.json();
        if (data.models) {
            console.log(`✅ SUCCESS. Found ${data.models.length} models available to this key.`);
            console.log('--- AVAILABLE MODELS ---');
            data.models.forEach((m: any) => {
                const isGemini = m.name.includes('gemini');
                if (isGemini) console.log(`   - ${m.name.replace('models/', '')}`);
            });
            console.log('------------------------');
        } else {
            console.error('⚠️  SUCCESS but NO models returned?');
            console.log(JSON.stringify(data, null, 2));
        }

    } catch (err: any) {
        console.error(`❌ Network Error: ${err.message}`);
    }
}

test();
