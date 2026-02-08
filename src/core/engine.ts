import { genkit, z } from 'genkit';
import { Opik } from 'opik';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Firestore } from 'firebase-admin/firestore';
import { MemoryManager } from './memory.js';

// Load environment variables (FORCE OVERRIDE stale shell variables)
dotenv.config({ override: true });

// Initialize Genkit
const ai = genkit({});

const GH_PATH = process.platform === 'win32' ? '"C:\\Program Files\\GitHub CLI\\gh.exe"' : 'gh';

export interface MomentumProposal {
    repoRef: string;
    targetFile: string;
    description: string;
    codeChange: string;
    title: string;
    body: string;
    originTraceId?: string; // Link to the planning trace
}

export interface MomentumResult {
    isStagnant: boolean;
    repoRef: string;
    daysSince?: number;
    proposal?: MomentumProposal;
    issueUrl?: string;
    status: 'ACTIVE' | 'STAGNANT_PLANNING' | 'COMPLETE' | 'FAILED';
    error?: string;
    evaluation?: EvaluationResult;
    proposalId?: string | null;
}

export interface EvaluationResult {
    score: number; // 1-10
    reasoning: string;
    isSafe: boolean;
}

export class CoreEngine {
    private model: any;
    private evaluator: any;
    private opik: Opik;
    private db: Firestore | null = null;
    private dbEnabled: boolean = true;
    public memory: MemoryManager;

    constructor() {
        // Robust Opik Init
        const opikKey = process.env.OPIK_API_KEY;
        if (opikKey) {
            this.opik = new Opik({
                projectName: 'momentum',
                apiKey: opikKey,
                headers: {
                    'Authorization': opikKey,
                    'Comet-Workspace': process.env.OPIK_WORKSPACE || '',
                },
            });
        } else {
            console.warn('[Core] OPIK_API_KEY not found. Running without observability.');
            this.opik = {
                trace: () => ({
                    span: () => ({ update: () => { }, end: () => { } }),
                    update: () => { },
                    end: () => { }
                }),
                flush: async () => { },
            } as any;
        }

        // Initialize Firebase Admin with Service Account
        try {
            if (getApps().length === 0) {
                const keyPath = path.resolve(process.cwd(), 'service-account-key.json');
                if (fs.existsSync(keyPath)) {
                    initializeApp({
                        credential: cert(keyPath),
                        projectId: 'momentum-shadow-dev-4321'
                    });
                } else {
                    initializeApp({
                        projectId: 'momentum-shadow-dev-4321'
                    });
                }
            }
            this.db = getFirestore();
            this.dbEnabled = true;
            console.log('[Core] Firestore initialized with Service Account.');
        } catch (err: any) {
            console.warn('[Core] Firestore init error:', err.message);
            this.dbEnabled = false;
        }

        this.memory = new MemoryManager(this.db as any);

        // Safety Diagnostic (verify tokens are actually loaded)
        const ghToken = process.env.GITHUB_TOKEN || '';
        const googleKey = process.env.GOOGLE_API_KEY || '';
        console.log(`[Core] Identity Check: GH_TOKEN (...${ghToken.slice(-4)}) | GOOGLE_KEY (...${googleKey.slice(-4)})`);

        const genAI = new GoogleGenerativeAI(googleKey);
        this.model = genAI.getGenerativeModel({
            model: 'gemini-3-flash-preview',
            systemInstruction: 'You are Momentum, a Shadow Developer agent powered by Gemini 3 Flash. Your purpose is to unblock stagnant repositories with high-quality, actionable code changes. \n' +
                '1. ALWAYS start by listing the files in the repository if you don\'t have a clear idea of the structure.\n' +
                '2. ALWAYS read the content of relevant files (package.json, README, or source files) before proposing a change.\n' +
                '3. Propose a change that actually improves the repo (e.g., adding a test, fixing a bug, updating a dependency, adding a feature).\n' +
                '4. ONLY call researchRepo when you have a specific, high-quality code change to propose.'
        });

        this.evaluator = genAI.getGenerativeModel({
            model: 'gemini-3-flash-preview',
            systemInstruction: 'You are the Senior Software Architect powered by Gemini 3 Flash. Your job is to EVALUATE code proposals from a junior developer.\n' +
                'Rubric:\n' +
                '1. Safety: Does this code delete data or break the build? (Fail if unsafe)\n' +
                '2. Relevance: Does it actually fix the described stagnation/issue?\n' +
                '3. Quality: Is the code idiomatic and correct?\n' +
                'Output JSON: { "score": number (1-10), "reasoning": string, "isSafe": boolean }'
        });
    }

    /**
     * Sends manual feedback to an Opik trace (e.g., from Discord Approve/Reject)
     */
    async updateOpikFeedback(traceId: string, score: number, name: string = 'human-feedback') {
        if (!process.env.OPIK_API_KEY || !traceId) return;

        console.log(`[Core] Sending Opik feedback: ${name}=${score} for trace ${traceId}`);
        const url = 'https://www.comet.com/opik/api/v1/feedback-scores';
        try {
            await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': process.env.OPIK_API_KEY || '',
                    'Content-Type': 'application/json',
                    'Comet-Workspace': process.env.OPIK_WORKSPACE || 'momentum'
                },
                body: JSON.stringify({
                    trace_id: traceId,
                    name: name,
                    value: score
                })
            });
        } catch (err: any) {
            console.warn('[Core] Failed to send Opik feedback:', err.message);
        }
    }

    /**
     * Persists a proposal to the 'proposals' collection for the dashboard history.
     */
    async saveProposalRecord(proposal: MomentumProposal, status: 'PENDING' | 'ACCEPTED' | 'REJECTED', evaluation: EvaluationResult) {
        if (!this.dbEnabled || !this.db) return null;

        const data = {
            ...proposal,
            status,
            evaluation,
            timestamp: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        };

        try {
            const docRef = await this.db.collection('proposals').add(data);
            console.log(`[Core] Proposal recorded in history: ${docRef.id}`);
            return docRef.id;
        } catch (err: any) {
            console.error('[Core] Failed to save proposal record:', err.message);
            return null;
        }
    }

    private async loadSkills(): Promise<string> {
        const skillsDir = path.resolve(process.cwd(), '.agent/skills');
        if (!fs.existsSync(skillsDir)) return '';

        try {
            const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));
            console.log(`[Core] Skill Sync: Found ${files.length} skill files in .agent/skills/`);
            let skillText = '\n--- EXPERT SYSTEM SKILLS ---\n';
            for (const file of files) {
                const content = fs.readFileSync(path.join(skillsDir, file), 'utf-8');
                skillText += `\n[Skill: ${file}]\n${content}\n`;
            }
            return skillText;
        } catch (err) {
            console.warn('[Core] Failed to load skills:', err);
            return '';
        }
    }

    private getTools(modelTier: 'flash' | 'pro' = 'flash') {
        // TIER 1: FLASH (Simplified Schema to prevent hallucinations/timeouts)
        if (modelTier === 'flash') {
            return [
                {
                    name: 'researchRepo',
                    description: 'Suggests a repo improvement. Call this ONLY after you have a specific plan.',
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            targetFile: { type: SchemaType.STRING, description: 'File path to modify.' },
                            description: { type: SchemaType.STRING, description: 'Summary of the change.' },
                            codeChange: { type: SchemaType.STRING, description: 'The code to apply.' },
                        },
                        required: ['targetFile', 'description', 'codeChange'],
                    },
                },
                {
                    name: 'listFiles',
                    description: 'List files in a directory.',
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            path: { type: SchemaType.STRING, description: 'Directory path (default root)' }
                        }
                    }
                },
                {
                    name: 'getFile',
                    description: 'Read file content.',
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            path: { type: SchemaType.STRING, description: 'File path.' }
                        },
                        required: ['path']
                    }
                }
            ];
        }

        // TIER 2: PRO (Full Schema - Reserved for Gemini 3.0)
        return [
            {
                name: 'researchRepo',
                description: 'Suggests a repo improvement or fix. Call this only after researching.',
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        targetFile: { type: SchemaType.STRING, description: 'The file to modify or create.' },
                        description: { type: SchemaType.STRING, description: 'Short summary of the change.' },
                        codeChange: { type: SchemaType.STRING, description: 'The actual code to be applied.' },
                    },
                    required: ['targetFile', 'description', 'codeChange'],
                },
            },
            // ... (Other tools identical for now, but extensible)
            {
                name: 'listFiles',
                description: 'List contents of a directory in the repo.',
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        path: { type: SchemaType.STRING, description: 'Directory path (relative to root, default "")' }
                    }
                }
            },
            {
                name: 'getFile',
                description: 'Read the content of a file.',
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        path: { type: SchemaType.STRING, description: 'File path relative to root.' }
                    },
                    required: ['path']
                }
            }
        ];
    }

    async plan(repoPath: string, metadata?: any, options?: { maintenanceOnly?: boolean }): Promise<MomentumResult> {
        let repoRef = repoPath;
        let trace: any;
        let cycleId = '';
        let daysSince = 0;

        try {
            // Initialize Opik safely
            try {
                trace = this.opik.trace({ name: options?.maintenanceOnly ? 'momentum-maintenance' : 'momentum-plan', input: { repoPath } });
                cycleId = trace.data.id;
                trace.update({ tags: [`repo:${repoPath}`, `cycle:${cycleId}`] });
            } catch (opikErr) {
                console.warn('[Core] Opik Trace Init Failed (Continuing without observability):', opikErr);
                // Fallback mock trace to prevent crash
                trace = {
                    span: () => ({ update: () => { }, end: () => { } }),
                    update: () => { },
                    end: () => { },
                    data: { id: 'no-trace' }
                };
            }

            repoRef = repoPath;
            const checkSpan = trace.span({ name: 'pulse-check' });
            const isRemote = repoPath.includes('github.com') || (!repoPath.startsWith('/') && !repoPath.startsWith('.') && repoPath.includes('/') && !repoPath.startsWith('C:'));
            let lastCommitTime = 0;

            if (isRemote) {
                if (repoPath.includes('github.com')) {
                    const match = repoPath.match(/github\.com\/([^\\/]+\/[^\\/]+)/);
                    repoRef = (match && match[1]) ? match[1].replace(/\.git$/, '') : repoPath;
                }
                if (metadata?.discordChannelId) {
                    await this.upsertRepoDoc(repoRef, {
                        discordChannelId: metadata.discordChannelId,
                        lastCheck: FieldValue.serverTimestamp(),
                        opikTraceId: trace.data.id
                    });
                }
            } else {
                repoRef = path.resolve(repoPath);
            }

            console.log(`[Core] Pulse Check: ${repoRef}`);
            const ghToken = process.env.GITHUB_TOKEN;

            if (isRemote) {
                const response = await fetch(`https://api.github.com/repos/${repoRef}`, {
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'User-Agent': 'Momentum-Shadow-Developer',
                        ...(ghToken ? { 'Authorization': `token ${ghToken}` } : {})
                    }
                });

                if (!response.ok) throw new Error(`GitHub API error: ${response.statusText}`);
                const data = await response.json() as any;
                lastCommitTime = new Date(data.pushed_at).getTime();
            } else {
                repoRef = path.resolve(repoPath);
                const out = execSync(`git -C "${repoRef}" log -1 --format=%ct`, { encoding: 'utf-8' }).trim();
                lastCommitTime = parseInt(out) * 1000;
            }

            daysSince = (Date.now() - lastCommitTime) / (24 * 60 * 60 * 1000);
            const isStagnant = daysSince > 3;

            checkSpan.update({ output: { isStagnant, daysSince, repoRef } });
            checkSpan.end();
            trace.update({ tags: [`repo:${repoRef}`] });

            if (!isStagnant) {
                const res: MomentumResult = { isStagnant: false, repoRef, daysSince, status: 'ACTIVE' };
                await this.upsertRepoDoc(repoRef, {
                    status: 'ACTIVE',
                    lastCheck: FieldValue.serverTimestamp(),
                    daysSince: Number(daysSince.toFixed(1)),
                    opikTraceId: trace.data.id,
                    ...(metadata || {})
                });
                trace.update({ output: res as any });
                trace.end();
                await this.opik.flush();
                return res;
            }

            if (options?.maintenanceOnly) {
                const res: MomentumResult = { isStagnant: true, repoRef, daysSince, status: 'STAGNANT_PLANNING' };
                await this.upsertRepoDoc(repoRef, {
                    status: 'STAGNANT_PLANNING',
                    lastCheck: FieldValue.serverTimestamp(),
                    daysSince: Number(daysSince.toFixed(1)),
                    ...(metadata || {})
                });
                trace.update({ output: res as any });
                trace.end();
                await this.opik.flush();
                return res;
            }

            console.log(`[Core] Stagnation detected (${daysSince.toFixed(1)} days). Researching...`);
            const researchSpan = trace.span({ name: 'brain-research', type: 'llm' });

            let context = 'No context available.';
            if (isRemote) {
                try {
                    const headers: any = {
                        'Accept': 'application/vnd.github.v3+json',
                        'User-Agent': 'Momentum-Shadow-Developer',
                        ...(ghToken ? { 'Authorization': `token ${ghToken}` } : {})
                    };
                    const readmeRes = await fetch(`https://api.github.com/repos/${repoRef}/readme`, { headers });
                    if (readmeRes.ok) {
                        const readmeData = await readmeRes.json() as any;
                        const content = Buffer.from(readmeData.content, 'base64').toString('utf-8').slice(0, 2000);
                        context = `README Snippet:\n${content}`;
                    }
                } catch (err) {
                    console.warn('[Core] Failed to fetch README:', err);
                }
            }

            // FETCH MEMORIES & SKILLS (The Recall)
            console.log('[Core] Recalling past experiences and documentation...');

            let memoryContext = '';
            let skills = '';

            try {
                const pastMemories = await this.memory.search(repoRef, 3);
                skills = await this.loadSkills();

                console.log(`[Core] "The Recall" complete: Recalled ${pastMemories.length} memories and active expert skills.`);

                if (pastMemories.length > 0) {
                    memoryContext = '\n--- LESSONS LEARNED (Past Experiences) ---\n';
                    pastMemories.forEach((m, i) => {
                        memoryContext += `[Lesson ${i + 1}] ${m.type.toUpperCase()}: ${m.text}\n`;
                    });
                }
            } catch (memErr) {
                console.warn('[Core] ⚠️ Memory Recall encountered an issue (Bot will continue without memory):', memErr);
            }

            // DYNAMIC BRAIN: Re-initialize model with enriched context
            const googleKey = process.env.GOOGLE_API_KEY || '';
            const genAI = new GoogleGenerativeAI(googleKey);
            const dynamicModel = genAI.getGenerativeModel({
                model: 'gemini-3-flash-preview',
                systemInstruction: 'You are Momentum, a Shadow Developer agent powered by Gemini 3 Flash. Your purpose is to unblock stagnant repositories with high-quality, actionable code changes. \n' +
                    '1. ALWAYS start by listing the files in the repository if you don\'t have a clear idea of the structure.\n' +
                    '2. ALWAYS read the content of relevant files (package.json, README, or source files) before proposing a change.\n' +
                    '3. Propose a change that actually improves the repo.\n' +
                    '4. ONLY call researchRepo when you have a specific, high-quality code change to propose.\n' +
                    '\nUSE THE FOLLOWING CONTEXT TO GUIDE YOUR DECISIONS:\n' +
                    memoryContext + '\n' +
                    skills
            });

            const chat = dynamicModel.startChat({ tools: [{ functionDeclarations: this.getTools() as any }] });
            let prompt = `Repository ${repoRef} is stagnant. \n\nContext:\n${context}\n\nPropose a high-impact improvement change now. Start by researching the repo structure.`;
            researchSpan.update({ input: { prompt } });


            let fc: any = null;
            let iter = 0;
            let currentMessage: any = prompt;

            // MAIN EXECUTION LOOP (Agent Reasoning)
            while (iter < 25) {
                console.log(`[Core] DEBUG: Sending message to model ${dynamicModel.model} (Iteration ${iter})...`);

                let result: any;
                try {
                    // UNIVERSAL SAFETY: 120s Timeout to prevent "Zombie Hangs" but allow Deep Reasoning
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Genkit API Timeout (120s)')), 120000)
                    );

                    console.log(`[Core] ⏳ Sending message (Timeout: 30s)...`);
                    result = await Promise.race([
                        chat.sendMessage(currentMessage),
                        timeoutPromise
                    ]);

                    console.log('[Core] ✅ API Call Successful.');
                } catch (err: any) {
                    // If timeout, we treat it as a fail state immediately
                    if (err.message.includes('Timeout')) {
                        console.error('[Core] ⏱️ API TIMEOUT - The model took too long to respond.');
                        return { isStagnant: false, repoRef, status: 'FAILED', error: 'Model Timeout (Possible Hallucination Loop)' };
                    }

                    console.error('------------------------------------------------');
                    console.error('[Core] 🚨 CRITICAL API ERROR 🚨');
                    console.error(`Message: ${err.message}`);
                    console.error(`Full Error:`, JSON.stringify(err, null, 2));
                    console.error('------------------------------------------------');
                    return { isStagnant: false, repoRef, status: 'FAILED', error: err.message };
                }

                const part = result.response.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall);
                fc = part?.functionCall;

                if (!fc) {
                    console.log('[Core] No tool call received. Agent finished reasoning.');
                    break;
                }

                let toolResult = 'Unknown tool error.';

                if (fc.name === 'researchRepo') {
                    console.log('[Core] Junior Dev proposed a change. Evaluating...');
                    const proposalArgs = fc.args as any;
                    const evalResult = await this.evaluateProposal(proposalArgs, context, trace, cycleId);

                    if (evalResult.score >= 7 && evalResult.isSafe) {
                        (proposalArgs as any)._evaluation = evalResult;
                        break;
                    } else {
                        const rejectionMsg = `Senior Dev Assessment (REJECTED): Score ${evalResult.score}/10.\nReasoning: ${evalResult.reasoning}\n\nPlease analyze the repo deeper and propose a BETTER fix.`;
                        toolResult = rejectionMsg;
                    }
                } else {
                    try {
                        if (fc.name === 'listFiles') {
                            const pathArg = (fc.args as any).path || '';
                            const res = await fetch(`https://api.github.com/repos/${repoRef}/contents/${pathArg}`, {
                                headers: {
                                    'Accept': 'application/vnd.github.v3+json',
                                    'User-Agent': 'Momentum-Shadow-Developer',
                                    ...(process.env.GH_TOKEN ? { 'Authorization': `token ${process.env.GH_TOKEN}` } : {})
                                }
                            });
                            const data = await res.json() as any;
                            toolResult = Array.isArray(data) ? data.map((f: any) => `${f.type === 'dir' ? '[DIR]' : '[FILE]'} ${f.path}`).join('\n') : JSON.stringify(data);
                        } else if (fc.name === 'getFile') {
                            const pathArg = (fc.args as any).path;
                            const res = await fetch(`https://api.github.com/repos/${repoRef}/contents/${pathArg}`, {
                                headers: {
                                    'Accept': 'application/vnd.github.v3+json',
                                    'User-Agent': 'Momentum-Shadow-Developer',
                                    ...(process.env.GH_TOKEN ? { 'Authorization': `token ${process.env.GH_TOKEN}` } : {})
                                }
                            });
                            const data = await res.json() as any;
                            toolResult = data.content ? Buffer.from(data.content, 'base64').toString('utf-8') : 'File empty or missing.';
                        }
                    } catch (err: any) {
                        toolResult = `Error: ${err.message}`;
                    }
                }

                currentMessage = [{
                    functionResponse: {
                        name: fc.name,
                        response: { name: fc.name, content: { result: toolResult } }
                    }
                }] as any;
                iter++;
            }

            if (!fc || fc.name !== 'researchRepo') {
                const err = `Brain timed out or failed to propose a valid plan after ${iter} iterations.`;
                trace.update({ output: { status: 'FAILED', error: err } });
                trace.end();
                await this.opik.flush();
                return { isStagnant: true, repoRef, status: 'FAILED', error: err };
            }

            const plan = fc.args as any;
            const proposal: MomentumProposal = {
                repoRef,
                targetFile: plan.targetFile,
                description: plan.description,
                codeChange: plan.codeChange,
                title: `Momentum: ${plan.description}`,
                body: `Automated improvement proposed to unblock development.\nTarget File: ${plan.targetFile}`,
                originTraceId: cycleId
            };

            const evaluation = (plan as any)._evaluation;
            console.log(`[Core] Evaluation: Senior Dev gave this proposal a ${evaluation.score}/10 score. Reasoning: ${evaluation.reasoning}`);
            const finalRes: MomentumResult = { isStagnant: true, repoRef, daysSince, proposal, status: 'STAGNANT_PLANNING', evaluation };

            await this.upsertRepoDoc(repoRef, {
                status: 'STAGNANT_PLANNING',
                lastCheck: FieldValue.serverTimestamp(),
                daysSince: Number(daysSince.toFixed(1)),
                activeProposal: proposal,
                evaluation,
                opikTraceId: cycleId,
                ...(metadata || {})
            });

            // Persist to history feed
            const proposalId = await this.saveProposalRecord(proposal, 'PENDING', evaluation);

            trace.update({ output: finalRes as any });
            trace.end();
            await this.opik.flush();
            return { ...finalRes, proposalId: proposalId ?? null };

        } catch (e: any) {
            console.error('[Core Error] plan failed:', e.message);
            trace.update({ output: { error: e.message } });
            trace.end();
            await this.opik.flush();
            return { isStagnant: false, repoRef: repoPath, status: 'FAILED', error: e.message };
        }
    }

    private async evaluateProposal(proposal: any, context: string, parentTrace: any, cycleId: string): Promise<EvaluationResult> {
        const evalSpan = parentTrace.span({ name: 'momentum-evaluate', type: 'llm' });
        evalSpan.update({ tags: [`cycle:${cycleId}`] });
        let prompt = '';
        try {
            prompt = `EVALUATE this proposal based on the rubric.\n\nContext:\n${context}\n\nProposal:\nFile: ${proposal.targetFile}\nDescription: ${proposal.description}\nCode Change:\n${proposal.codeChange}`;
            let result;
            let retryCount = 0;
            while (true) {
                try {
                    result = await this.evaluator.generateContent(prompt);
                    break;
                } catch (apiErr: any) {
                    if (apiErr.message?.includes('503') || apiErr.message?.includes('Overloaded')) {
                        retryCount++;
                        if (retryCount > 3) throw apiErr;
                        await new Promise(r => setTimeout(r, Math.pow(2, retryCount) * 1000));
                    } else throw apiErr;
                }
            }
            const data = JSON.parse(result.response.text().replace(/```json/g, '').replace(/```/g, '').trim());
            const score = data.score || 0;
            const reasoning = data.reasoning || 'No reasoning provided.';
            const isSafe = data.isSafe ?? false;

            if (!isSafe || score < 7) {
                if (this.dbEnabled) {
                    await this.memory.addMemory(`REJECTION: ${reasoning}\nContext: ${proposal.description}`, 'negative', proposal.repoRef, { score, targetFile: proposal.targetFile });
                }
            }

            evalSpan.update({ output: { score, reasoning, isSafe } });
            evalSpan.end();
            return { score, reasoning, isSafe };
        } catch (err: any) {
            evalSpan.update({ output: { error: err.message, score: 0 } });
            evalSpan.end();
            return { score: 0, reasoning: `Evaluation crashed: ${err.message}`, isSafe: false };
        }
    }

    async execute(proposal: MomentumProposal): Promise<MomentumResult> {
        console.log(`[Core] 🚀 Executing approved Shadow PR for ${proposal.repoRef}...`);
        const trace = this.opik.trace({ name: 'momentum-execute', input: { proposal }, tags: [`repo:${proposal.repoRef}`, `cycle:${proposal.originTraceId}`] });
        try {
            const repoUrl = proposal.repoRef.startsWith('http') ? proposal.repoRef : `https://github.com/${proposal.repoRef}`;
            const ghToken = process.env.GITHUB_TOKEN;

            console.log(`[Core] Creating real GitHub issue for ${proposal.repoRef}...`);

            // 1. Create the Issue via API
            const response = await fetch(`https://api.github.com/repos/${proposal.repoRef}/issues`, {
                method: 'POST',
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${ghToken}`,
                    'User-Agent': 'Momentum-Shadow-Developer'
                },
                body: JSON.stringify({
                    title: proposal.title,
                    body: `${proposal.body}\n\n### 🛠️ Proposed Change\n\n\`\`\`diff\n${proposal.codeChange}\n\`\`\`\n\n*Created by Momentum Shadow Developer*`
                })
            });

            if (!response.ok) {
                const errData = await response.json() as any;
                throw new Error(`GitHub API Error: ${errData.message || response.statusText}`);
            }

            const issueData = await response.json() as any;
            const issueUrl = issueData.html_url;
            console.log(`[Core] ✅ GitHub Issue Created: ${issueUrl}`);

            // Persist to DB
            if (this.dbEnabled) {
                // AUTO-LEARNING: Save successful unblock as a "Positive Memory"
                await this.memory.addMemory(
                    `SUCCESS: Resolved stagnation in ${proposal.repoRef}.\nTarget: ${proposal.targetFile}\nDescription: ${proposal.description}`,
                    'positive',
                    proposal.repoRef,
                    { issueUrl }
                );

                await this.upsertRepoDoc(proposal.repoRef, {
                    lastPush: FieldValue.serverTimestamp(),
                    lastIssueUrl: issueUrl
                });

                // Update proposal status in history
                if (proposal.originTraceId) {
                    const proposalsCol = this.db!.collection('proposals');
                    const snap = await proposalsCol
                        .where('originTraceId', '==', proposal.originTraceId)
                        .limit(1)
                        .get();
                    if (!snap.empty) {
                        await snap.docs[0]!.ref.update({
                            status: 'ACCEPTED',
                            issueUrl: issueUrl,
                            updatedAt: FieldValue.serverTimestamp()
                        });
                    }

                    // Send Opik Feedback
                    await this.updateOpikFeedback(proposal.originTraceId, 1.0, 'acceptance');
                }
            }

            trace.update({ output: { status: 'COMPLETE', issueUrl } });
            trace.end();
            await this.opik.flush();
            return { isStagnant: true, repoRef: proposal.repoRef, status: 'COMPLETE', issueUrl };
        } catch (e: any) {
            trace.update({ output: { error: e.message } });
            trace.end();
            await this.opik.flush();
            return { isStagnant: true, repoRef: proposal.repoRef, status: 'FAILED', error: e.message };
        }
    }

    private async upsertRepoDoc(repoRef: string, data: any) {
        if (!this.dbEnabled || !this.db) return;
        const docId = repoRef.replace(/\//g, '-');
        await this.db.collection('repositories').doc(docId).set({ repoRef, ...data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }

    async listRepos() {
        if (!this.dbEnabled || !this.db) return [];
        const snapshot = await this.db.collection('repositories').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async untrack(repoPath: string) {
        if (!this.dbEnabled || !this.db) return { success: false, error: 'Database not enabled.' };
        const repoRef = repoPath.includes('github.com') ? (repoPath.match(/github\.com\/([^\\/]+\/[^\\/]+)/)?.[1] || repoPath) : repoPath;
        const docId = repoRef.replace(/\//g, '-');
        await this.db.collection('repositories').doc(docId).delete();
        return { success: true };
    }

    async linkAccount(discordId: string, email: string) {
        if (!this.dbEnabled || !this.db) return { success: false, error: 'Database not enabled.' };
        await this.db.collection('users').doc(email).set({ discordId, email, linkedAt: FieldValue.serverTimestamp() }, { merge: true });
        return { success: true };
    }

    async monitorRepo(repoPath: string, discordChannelId: string) {
        if (!this.dbEnabled || !this.db) return { success: false, error: 'Database not enabled.' };
        const repoRef = repoPath.includes('github.com') ? (repoPath.match(/github\.com\/([^\\/]+\/[^\\/]+)/)?.[1] || repoPath) : repoPath;
        await this.upsertRepoDoc(repoRef, {
            discordChannelId,
            status: 'ACTIVE',
            lastPatrolAt: FieldValue.serverTimestamp()
        });
        return { success: true, repoRef };
    }
}
