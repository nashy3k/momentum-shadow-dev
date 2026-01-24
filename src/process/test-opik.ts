import { Opik } from 'opik';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Manual loading to ensure no Windows-specific parsing issues
const envPath = path.resolve(process.cwd(), '.env');
const envVars = dotenv.parse(fs.readFileSync(envPath));
for (const k in envVars) {
    process.env[k] = (envVars[k] || '').trim();
}

console.log('--- Opik Debug Test ---');
console.log('Project:', 'momentum-test');
console.log('Workspace:', process.env.OPIK_WORKSPACE);
console.log('API Key length:', process.env.OPIK_API_KEY?.length);

const opik = new Opik({
    projectName: 'momentum-test',
    apiKey: process.env.OPIK_API_KEY,
    workspaceName: process.env.OPIK_WORKSPACE,
    // Workaround for 401 identified in community Discord
    headers: {
        'Authorization': process.env.OPIK_API_KEY || '',
        'Comet-Workspace': process.env.OPIK_WORKSPACE || '',
    },
});

async function runTest() {
    console.log('Creating trace...');
    const trace = opik.trace({
        name: 'test-trace',
        input: { hello: 'world' }
    });

    console.log('Creating span...');
    const span = trace.span({
        name: 'test-span',
        input: { data: 123 }
    });

    span.end({ output: { success: true } });
    trace.end({ output: { result: 'ok' } });

    console.log('Flushing data...');
    try {
        await opik.flush();
        console.log('Final Flush Complete.');
    } catch (e: any) {
        console.error('Flush Error:', e.message);
    }
}

runTest().catch(console.error);
