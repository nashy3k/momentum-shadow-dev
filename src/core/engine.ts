import { genkit, z } from 'genkit';
import { Opik } from 'opik';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Firestore } from 'firebase-admin/firestore';

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

        // Safety Diagnostic (verify tokens are actually loaded)
        const ghToken = process.env.GITHUB_TOKEN || '';
        const googleKey = process.env.GOOGLE_API_KEY || '';
        console.log(`[Core] Identity Check: GH_TOKEN (...${ghToken.slice(-4)}) | GOOGLE_KEY (...${googleKey.slice(-4)})`);

        const genAI = new GoogleGenerativeAI(googleKey);
        this.model = genAI.getGenerativeModel({
            model: 'gemini-3-flash-preview',
            systemInstruction: 'You are Momentum, a Shadow Developer agent. Your purpose is to unblock stagnant repositories with high-quality, actionable code changes. \n' +
                '1. ALWAYS start by listing the files in the repository if you don\'t have a clear idea of the structure.\n' +
                '2. ALWAYS read the content of relevant files (package.json, README, or source files) before proposing a change.\n' +
                '3. Propose a change that actually improves the repo (e.g., adding a test, fixing a bug, updating a dependency, adding a feature).\n' +
                '4. ONLY call researchRepo when you have a specific, high-quality code change to propose.'
        });

        this.evaluator = genAI.getGenerativeModel({
            model: 'gemini-3-flash-preview',
            systemInstruction: 'You are the Senior Software Architect. Your job is to EVALUATE code proposals from a junior developer.\n' +
                'Rubric:\n' +
                '1. Safety: Does this code delete data or break the build? (Fail if unsafe)\n' +
                '2. Relevance: Does it actually fix the described stagnation/issue?\n' +
                '3. Quality: Is the code idiomatic and correct?\n' +
                'Output JSON: { "score": number (1-10), "reasoning": string, "isSafe": boolean }'
        });
    }

    private getTools() {
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

    /**
     * Phase 1: Checks pulse and generates a plan if stagnant.
     */
    async plan(repoPath: string, metadata?: any, options?: { maintenanceOnly?: boolean }): Promise<MomentumResult> {
        const trace = this.opik.trace({ name: options?.maintenanceOnly ? 'momentum-maintenance' : 'momentum-plan', input: { repoPath } });

        // CYCLE TAGGING: Use this trace ID as the unique Cycle ID to link Plan and Execute phases
        const cycleId = trace.data.id;
        trace.update({ tags: [`repo:${repoPath}`, `cycle:${cycleId}`] });
        try {
            // Pulse Check
            const checkSpan = trace.span({ name: 'pulse-check' });
            const isRemote = repoPath.includes('github.com') || (!repoPath.startsWith('/') && !repoPath.startsWith('.') && repoPath.includes('/') && !repoPath.startsWith('C:'));
            let lastCommitTime = 0;
            let repoRef = repoPath;

            if (isRemote) {
                if (repoPath.includes('github.com')) {
                    const match = repoPath.match(/github\.com\/([^\\/]+\/[^\\/]+)/);
                    repoRef = (match && match[1]) ? match[1].replace(/\.git$/, '') : repoPath;
                }

                // Early Sync: Save the Discord Channel ID immediately so we don't lose it if AI fails later
                if (metadata?.discordChannelId) {
                    await this.upsertRepoDoc(repoRef, {
                        discordChannelId: metadata.discordChannelId,
                        lastCheck: FieldValue.serverTimestamp(),
                        opikTraceId: trace.data.id // Link the trace immediately
                    });
                }
            } else {
                repoRef = path.resolve(repoPath);
            }

            console.log(`[Core] Pulse Check: ${repoRef}`);
            const ghToken = process.env.GITHUB_TOKEN;

            if (isRemote) {
                // Use native fetch instead of GH CLI for Cloud compatibility
                console.log(`[Core] Fetching API: https://api.github.com/repos/${repoRef}`);
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

            const daysSince = (Date.now() - lastCommitTime) / (24 * 60 * 60 * 1000);
            const isStagnant = daysSince > 3;

            checkSpan.update({ output: { isStagnant, daysSince, repoRef } });
            checkSpan.end();

            // UPDATE TRACE TAGS: Associate this trace with the specific repo for filtering
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

            // Maintenance Mode: Sync and Return
            if (options?.maintenanceOnly) {
                const res: MomentumResult = { isStagnant: true, repoRef, daysSince, status: 'STAGNANT_PLANNING' };
                await this.upsertRepoDoc(repoRef, {
                    status: 'STAGNANT_PLANNING',
                    lastCheck: FieldValue.serverTimestamp(),
                    daysSince: Number(daysSince.toFixed(1)),
                    // Do NOT overwrite opikTraceId here. We want to keep the link to the actual "Brain" run.
                    ...(metadata || {})
                });
                trace.update({ output: res as any });
                trace.end();
                await this.opik.flush();
                console.log(`[Core] Maintenance Sync: ${repoRef} (STAGNANT)`);
                return res;
            }


            // Brain Research
            console.log(`[Core] Stagnation detected (${daysSince.toFixed(1)} days). Researching...`);
            const researchSpan = trace.span({ name: 'brain-research', type: 'llm' });

            let context = 'No context available.';
            if (isRemote) {
                try {
                    const headers: any = {
                        'Accept': 'application/vnd.github.v3+json',
                        'User-Agent': 'Momentum-Shadow-Developer'
                    };
                    if (process.env.GITHUB_TOKEN) {
                        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
                    }
                    console.log(`[Core] Fetching README for context: ${repoRef}`);
                    const readmeRes = await fetch(`https://api.github.com/repos/${repoRef}/readme`, { headers });
                    if (readmeRes.ok) {
                        const readmeData = await readmeRes.json() as any;
                        const content = Buffer.from(readmeData.content, 'base64').toString('utf-8').slice(0, 2000); // Limit context
                        context = `README Snippet:\n${content}`;
                    }
                } catch (err) {
                    console.warn('[Core] Failed to fetch README:', err);
                }
            }

            const chat = this.model.startChat({ tools: [{ functionDeclarations: this.getTools() as any }] });
            let prompt = `Repository ${repoRef} is stagnant. \n\nContext:\n${context}\n\nPropose a high-impact improvement change now. Start by researching the repo structure.`;
            researchSpan.update({ input: { prompt } });

            let fc: any = null;
            let iter = 0;
            let currentMessage = prompt;

            // Research Loop (Max 25 steps for deep research + retries)
            while (iter < 25) {
                const result = await chat.sendMessage(currentMessage);
                const part = result.response.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall);
                fc = part?.functionCall;

                if (!fc) break; // No more tool calls

                let toolResult = 'Unknown tool error.';

                // INTERCEPT: If the bot wants to propose a fix, we evaluate it first ("Senior Dev Gatekeeper")
                if (fc.name === 'researchRepo') {
                    console.log('[Core] Junior Dev proposed a change. Evaluating...');
                    const proposalArgs = fc.args as any;

                    // Call Evaluation
                    const evalResult = await this.evaluateProposal(proposalArgs, context, trace, cycleId);
                    console.log(`[Core] Evaluation Result: Score ${evalResult.score}/10. Safe: ${evalResult.isSafe}`);

                    if (evalResult.score >= 7 && evalResult.isSafe) {
                        // PASS: We break the loop and accept this proposal
                        console.log('[Core] Proposal APPROVED by Senior Dev.');
                        // Attach evaluation to the final result
                        (proposalArgs as any)._evaluation = evalResult;
                        break;
                    } else {
                        // FAIL: We reject and force the bot to retry
                        console.warn(`[Core] Proposal REJECTED. Reasoning: ${evalResult.reasoning}`);
                        const rejectionMsg = `Senior Dev Assessment (REJECTED): Score ${evalResult.score}/10.\nReasoning: ${evalResult.reasoning}\n\nPlease analyze the repo deeper (use listFiles/getFile) and propose a BETTER fix.`;

                        toolResult = rejectionMsg;
                        // We do NOT break, we let the loop continue with this feedback
                    }
                } else {
                    console.log(`[Core] Tool Call: ${fc.name}(${JSON.stringify(fc.args)})`);
                }

                try {
                    if (fc.name === 'listFiles') {
                        const pathArg = (fc.args as any).path || '';
                        const res = await fetch(`https://api.github.com/repos/${repoRef}/contents/${pathArg}`, {
                            headers: {
                                'Accept': 'application/vnd.github.v3+json',
                                'User-Agent': 'Momentum-Shadow-Developer',
                                ...(process.env.GITHUB_TOKEN ? { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {})
                            }
                        });
                        if (!res.ok) {
                            toolResult = `GitHub API Error (listFiles): ${res.status} ${res.statusText}. Check GITHUB_TOKEN.`;
                        } else {
                            const data = await res.json() as any;
                            toolResult = Array.isArray(data)
                                ? data.map((f: any) => `${f.type === 'dir' ? '[DIR]' : '[FILE]'} ${f.path}`).join('\n')
                                : JSON.stringify(data);
                        }
                    } else if (fc.name === 'getFile') {
                        const pathArg = (fc.args as any).path;
                        const res = await fetch(`https://api.github.com/repos/${repoRef}/contents/${pathArg}`, {
                            headers: {
                                'Accept': 'application/vnd.github.v3+json',
                                'User-Agent': 'Momentum-Shadow-Developer',
                                ...(process.env.GITHUB_TOKEN ? { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {})
                            }
                        });

                        if (!res.ok) {
                            toolResult = `GitHub API Error (getFile): ${res.status} ${res.statusText}. Check GITHUB_TOKEN.`;
                        } else {
                            const data = await res.json() as any;
                            if (data && data.content) {
                                toolResult = Buffer.from(data.content, 'base64').toString('utf-8');
                            } else {
                                toolResult = `Error: File content missing in GitHub response.`;
                            }
                        }
                    }
                } catch (err: any) {
                    // Only overwrite toolResult if it wasn't already set by the rejection logic
                    // But wait, rejection logic is for 'researchRepo', which falls through here?
                    // 'researchRepo' is NOT 'listFiles' or 'getFile', so the if/else if above will skip.
                    // But toolResult is already set.
                    // If an error happens in listFiles/getFile, we capture it.
                    if (fc.name !== 'researchRepo') {
                        toolResult = `Error: ${err.message}`;
                    }
                }

                console.log(`[Core] Tool Result: ${toolResult.slice(0, 100)}...`);

                currentMessage = [{
                    functionResponse: {
                        name: fc.name,
                        response: { name: fc.name, content: { result: toolResult } }
                    }
                }] as any;

                iter++;
            }

            if (!fc || fc.name !== 'researchRepo') {
                const err = `Brain timed out after ${iter} steps without a final proposal.`;
                researchSpan.update({ output: { error: err, text: '' } });
                researchSpan.end();
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
                originTraceId: cycleId // Pass the cycle ID to the proposal
            };

            const evaluation = (plan as any)._evaluation;
            researchSpan.update({ output: { proposal, evaluation } });
            researchSpan.end();
            const finalRes: MomentumResult = {
                isStagnant: true,
                repoRef,
                daysSince,
                proposal,
                status: 'STAGNANT_PLANNING',
                evaluation // Pass to result
            };

            await this.upsertRepoDoc(repoRef, {
                status: 'STAGNANT_PLANNING',
                lastCheck: FieldValue.serverTimestamp(),
                daysSince: Number(daysSince.toFixed(1)),
                activeProposal: proposal,
                evaluation, // Store in DB
                opikTraceId: cycleId, // CRITICAL: Save for Dashboard Deep-Link
                ...(metadata || {}) // Merge any discord metadata
            });

            trace.update({ output: finalRes as any });
            trace.end();
            await this.opik.flush();
            return finalRes;

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
        // Force tag this span in case it is promoted to a Trace
        evalSpan.update({ tags: [`cycle:${cycleId}`] });
        let prompt = '';
        try {
            prompt = `EVALUATE this proposal based on the rubric.\n\nContext:\n${context}\n\nProposal:\nFile: ${proposal.targetFile}\nDescription: ${proposal.description}\nCode Change:\n${proposal.codeChange}`;

            // Retry loop for 503 Service Unavailable (Gemini Overload)
            let result;
            let retryCount = 0;
            const maxRetries = 3;

            while (true) {
                try {
                    result = await this.evaluator.generateContent(prompt);
                    break;
                } catch (apiErr: any) {
                    if (apiErr.message?.includes('503') || apiErr.message?.includes('Overloaded')) {
                        retryCount++;
                        if (retryCount > maxRetries) throw apiErr;
                        const waitTime = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
                        console.warn(`[Core] Gemini Overloaded (503). Retrying in ${waitTime}ms...`);
                        await new Promise(r => setTimeout(r, waitTime));
                    } else {
                        throw apiErr;
                    }
                }
            }
            const text = result.response.text();

            // Clean markdown syntax if present
            const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(cleanText);

            const resultObj: EvaluationResult = {
                score: data.score || 0,
                reasoning: data.reasoning || 'No reasoning provided.',
                isSafe: data.isSafe ?? false
            };

            evalSpan.update({ input: { prompt }, output: resultObj as any });
            evalSpan.end();
            return resultObj;
        } catch (err: any) {
            console.error('[Core] Evaluation failed:', err);
            // Capture the failure in the span so it's not "empty"
            evalSpan.update({
                input: { prompt: prompt || 'Prompt generation failed.' },
                output: { error: err.message, score: 0 }
            });
            evalSpan.end();
            return { score: 0, reasoning: `Evaluation crashed: ${err.message}`, isSafe: false };
        }
    }

    /**
     * Phase 2: Executes a previously generated plan.
     */
    async execute(proposal: MomentumProposal): Promise<MomentumResult> {
        const tags = [`repo:${proposal.repoRef}`];
        if (proposal.originTraceId) tags.push(`cycle:${proposal.originTraceId}`);

        const trace = this.opik.trace({
            name: 'momentum-execute',
            input: { proposal },
            tags
        });
        try {
            const sTitle = proposal.title.replace(/"/g, "'");
            const sBody = `${proposal.body}\n\nProposed Change:\n\`\`\`\n${proposal.codeChange}\n\`\`\``.replace(/"/g, "'");

            const headers: any = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Momentum-Shadow-Developer'
            };
            if (process.env.GITHUB_TOKEN) {
                headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
            }

            console.log(`[Core] Creating Issue via API: ${proposal.repoRef}`);
            const response = await fetch(`https://api.github.com/repos/${proposal.repoRef}/issues`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ title: sTitle, body: sBody })
            });

            if (!response.ok) throw new Error(`GitHub Create Issue Error: ${response.statusText}`);
            const data = await response.json() as any;
            const url = data.html_url;

            const res: MomentumResult = {
                isStagnant: true,
                repoRef: proposal.repoRef,
                issueUrl: url,
                status: 'COMPLETE'
            };

            await this.upsertRepoDoc(proposal.repoRef, {
                status: 'COMPLETE',
                lastCheck: FieldValue.serverTimestamp(),
                issueUrl: url,
                lastProposal: proposal, // Persist the proposal details
                unblocks: FieldValue.increment(1) // Track the win
            });

            trace.update({ output: res as any });
            trace.end();
            await this.opik.flush();
            return res;
        } catch (e: any) {
            console.error('[Core Error] execute failed:', e.message);

            await this.upsertRepoDoc(proposal.repoRef, {
                status: 'FAILED',
                lastCheck: FieldValue.serverTimestamp(),
                error: e.message
            });

            trace.update({ output: { error: e.message } });
            trace.end();
            await this.opik.flush();
            return { isStagnant: true, repoRef: proposal.repoRef, status: 'FAILED', error: e.message };
        }
    }

    async listRepos(): Promise<any[]> {
        if (!this.dbEnabled || !this.db) return [];
        const snapshot = await this.db.collection('repositories').get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
    }

    private async upsertRepoDoc(repoRef: string, data: any) {
        if (!this.dbEnabled || !this.db) return;

        const docId = repoRef.replace(/\//g, '-');
        try {
            await this.db.collection('repositories').doc(docId).set({
                repoRef,
                ...data,
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
            console.log(`[Core] Firestore Sync: repositories/${docId}`);
        } catch (err: any) {
            console.warn(`[Core Firestore Warn] Sync failed: ${err.message}. Disabling DB for this session.`);
            this.dbEnabled = false;
        }
    }

    async untrack(repoPath: string): Promise<{ success: boolean; error?: string }> {
        if (!this.dbEnabled || !this.db) {
            return { success: false, error: 'Database not enabled.' };
        }

        let repoRef = '';
        if (repoPath.includes('github.com')) {
            const match = repoPath.match(/github\.com\/([^\\/]+\/[^\\/]+)/);
            repoRef = (match && match[1]) ? match[1].replace(/\.git$/, '') : repoPath;
        } else {
            repoRef = repoPath;
        }

        const docId = repoRef.replace(/\//g, '-');
        try {
            await this.db.collection('repositories').doc(docId).delete();
            console.log(`[Core] Firestore Untrack: repositories/${docId}`);
            return { success: true };
        } catch (err: any) {
            console.error(`[Core Error] Untrack failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    async linkAccount(discordId: string, email: string): Promise<{ success: boolean; error?: string }> {
        if (!this.dbEnabled || !this.db) {
            return { success: false, error: 'Database not enabled.' };
        }

        try {
            await this.db.collection('users').doc(email).set({
                discordId,
                email,
                linkedAt: FieldValue.serverTimestamp()
            }, { merge: true });
            console.log(`[Core] Identity Linked: ${discordId} -> ${email}`);
            return { success: true };
        } catch (err: any) {
            console.error(`[Core Error] Link failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    }
}
