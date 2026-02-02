import { genkit, z } from 'genkit';
import { Opik } from 'opik';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Firestore } from 'firebase-admin/firestore';

// Initialize Genkit
const ai = genkit({});

const GH_PATH = '"C:\\Program Files\\GitHub CLI\\gh.exe"';

export interface MomentumProposal {
    repoRef: string;
    targetFile: string;
    description: string;
    codeChange: string;
    title: string;
    body: string;
}

export interface MomentumResult {
    isStagnant: boolean;
    repoRef: string;
    daysSince?: number;
    proposal?: MomentumProposal;
    issueUrl?: string;
    status: 'ACTIVE' | 'STAGNANT_PLANNING' | 'COMPLETE' | 'FAILED';
    error?: string;
}

export class CoreEngine {
    private model: any;
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

        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
        this.model = genAI.getGenerativeModel({
            model: 'gemini-3-flash-preview',
            systemInstruction: 'You are Momentum, a Shadow Developer agent. Your sole purpose is to unblock stagnant repositories. You MUST call researchRepo to propose an improvement. DO NOT TALK. ONLY CALL TOOLS.'
        });
    }

    private getTools() {
        return [
            {
                name: 'researchRepo',
                description: 'Suggests a repo improvement or fix.',
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        targetFile: { type: SchemaType.STRING },
                        description: { type: SchemaType.STRING },
                        codeChange: { type: SchemaType.STRING },
                    },
                    required: ['targetFile', 'description', 'codeChange'],
                },
            }
        ];
    }

    /**
     * Phase 1: Checks pulse and generates a plan if stagnant.
     */
    async plan(repoPath: string): Promise<MomentumResult> {
        const trace = this.opik.trace({ name: 'momentum-plan', input: { repoPath } });
        try {
            // Pulse Check
            const checkSpan = trace.span({ name: 'pulse-check' });
            console.log(`[Core] Pulse Check: ${repoPath}`);

            const isRemote = repoPath.includes('github.com');
            let lastCommitTime = 0;
            let repoRef = '';

            if (isRemote) {
                const match = repoPath.match(/github\.com\/([^\\/]+\/[^\\/]+)/);
                repoRef = (match && match[1]) ? match[1].replace(/\.git$/, '') : repoPath;

                // Use native fetch instead of GH CLI for Cloud compatibility
                console.log(`[Core] Fetching API: https://api.github.com/repos/${repoRef}`);
                const response = await fetch(`https://api.github.com/repos/${repoRef}`, {
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'User-Agent': 'Momentum-Shadow-Developer'
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

            if (!isStagnant) {
                const res: MomentumResult = { isStagnant: false, repoRef, daysSince, status: 'ACTIVE' };
                await this.upsertRepoDoc(repoRef, {
                    status: 'ACTIVE',
                    lastCheck: FieldValue.serverTimestamp(),
                    daysSince: Number(daysSince.toFixed(1))
                });
                trace.update({ output: res as any });
                trace.end();
                await this.opik.flush();
                return res;
            }


            // Brain Research
            console.log(`[Core] Stagnation detected (${daysSince.toFixed(1)} days). Researching...`);
            const researchSpan = trace.span({ name: 'brain-research', type: 'llm' });

            let context = 'No context available.';
            if (isRemote) {
                try {
                    console.log(`[Core] Fetching README for context: ${repoRef}`);
                    const readmeRes = await fetch(`https://api.github.com/repos/${repoRef}/readme`, {
                        headers: {
                            'Accept': 'application/vnd.github.v3+json',
                            'User-Agent': 'Momentum-Shadow-Developer',
                            'Authorization': `token ${process.env.GITHUB_TOKEN || ''}`
                        }
                    });
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
            const prompt = `Repository ${repoRef} is stagnant. \n\nContext:\n${context}\n\nPropose a high-impact improvement change now with researchRepo tool.`;
            researchSpan.update({ input: { prompt } });

            const result = await chat.sendMessage(prompt);
            const fc = result.response.candidates?.[0]?.content?.parts?.find((p: any) => (p as any).functionCall)?.functionCall;

            if (!fc || fc.name !== 'researchRepo') {
                const err = 'Brain failed to generate a tool-based plan.';
                researchSpan.update({ output: { error: err, text: result.response.text ? result.response.text() : '' } });
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
                body: `Automated improvement proposed to unblock development.\nTarget File: ${plan.targetFile}`
            };

            researchSpan.update({ output: { proposal } });
            researchSpan.end();
            const finalRes: MomentumResult = { isStagnant: true, repoRef, daysSince, proposal, status: 'STAGNANT_PLANNING' };

            await this.upsertRepoDoc(repoRef, {
                status: 'STAGNANT_PLANNING',
                lastCheck: FieldValue.serverTimestamp(),
                daysSince: Number(daysSince.toFixed(1)),
                activeProposal: proposal
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

    /**
     * Phase 2: Executes a previously generated plan.
     */
    async execute(proposal: MomentumProposal): Promise<MomentumResult> {
        const trace = this.opik.trace({ name: 'momentum-execute', input: { proposal } });
        try {
            const sTitle = proposal.title.replace(/"/g, "'");
            const sBody = `${proposal.body}\n\nProposed Change:\n\`\`\`\n${proposal.codeChange}\n\`\`\``.replace(/"/g, "'");

            console.log(`[Core] Creating Issue via API: ${proposal.repoRef}`);
            const response = await fetch(`https://api.github.com/repos/${proposal.repoRef}/issues`, {
                method: 'POST',
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${process.env.GITHUB_TOKEN || ''}`,
                    'User-Agent': 'Momentum-Shadow-Developer'
                },
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
                activeProposal: null // Clear it once done
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
