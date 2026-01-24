import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { CoreEngine } from './core/engine';

// Robust .env loading
const envPath = path.resolve(process.cwd(), '.env');
try {
    const rawEnv = fs.readFileSync(envPath);
    const envVars = dotenv.parse(rawEnv);
    for (const key in envVars) {
        process.env[key] = (envVars[key] || '').trim();
    }
} catch (err) {
    console.error('ERROR: Failed to load .env file:', err);
}

async function runCli() {
    const repoPath = process.argv[2] || '.';
    const engine = new CoreEngine();

    console.log(`--- Momentum CLI: ${repoPath} ---`);

    // Phase 1: Plan
    const result = await engine.plan(repoPath);

    if (result.status === 'ACTIVE') {
        console.log(`✅ ${result.repoRef} is healthy.`);
        return;
    }

    if (result.status === 'FAILED') {
        console.error(`❌ Plan failed: ${result.error}`);
        return;
    }

    if (result.proposal) {
        console.log(`🚨 Stagnant! Proposal: ${result.proposal.description}`);

        // In CLI mode, we "auto-approve" or could add a readline check here.
        // For now, let's auto-execute to match previous behavior but using the modular engine.
        console.log('[CLI] Auto-approving plan...');
        const finalResult = await engine.execute(result.proposal);

        if (finalResult.status === 'COMPLETE') {
            console.log(`🚀 Success: ${finalResult.issueUrl}`);
        } else {
            console.error(`❌ Execution failed: ${finalResult.error}`);
        }
    }
}

runCli().catch(console.error);
