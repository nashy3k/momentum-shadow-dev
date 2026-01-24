import { genkit, z } from 'genkit';
import { Opik } from 'opik';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

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

    constructor() {
        // Ensure env is loaded or assumed to be loaded by the caller
        this.opik = new Opik({
            projectName: 'momentum',
            apiKey: process.env.OPIK_API_KEY,
            headers: {
                'Authorization': process.env.OPIK_API_KEY || '',
                'Comet-Workspace': process.env.OPIK_WORKSPACE || '',
            },
        });

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
                const match = repoPath.match(/github\.com\/([^\/]+\/[^\/]+)/);
                repoRef = match ? match[1].replace(/\.git$/, '') : repoPath;
                const out = execSync(`${GH_PATH} api repos/${repoRef} --jq .pushed_at`, { encoding: 'utf-8' }).trim();
                lastCommitTime = new Date(out).getTime();
            } else {
                repoRef = path.resolve(repoPath);
                const out = execSync(`git -C "${repoRef}" log -1 --format=%ct`, { encoding: 'utf-8' }).trim();
                lastCommitTime = parseInt(out) * 1000;
            }

            const daysSince = (Date.now() - lastCommitTime) / (24 * 60 * 60 * 1000);
            const isStagnant = daysSince > 3;

            checkSpan.end({ output: { isStagnant, daysSince, repoRef } });

            if (!isStagnant) {
                const res: MomentumResult = { isStagnant: false, repoRef, daysSince, status: 'ACTIVE' };
                trace.end({ output: res });
                await this.opik.flush();
                return res;
            }

            // Brain Research
            console.log(`[Core] Stagnation detected (${daysSince.toFixed(1)} days). Researching...`);
            const researchSpan = trace.span({ name: 'brain-research', type: 'llm' });

            const chat = this.model.startChat({ tools: [{ functionDeclarations: this.getTools() as any }] });
            const prompt = `Repository ${repoRef} is stagnant. Propose a change now with researchRepo.`;
            researchSpan.update({ input: { prompt } });

            const result = await chat.sendMessage(prompt);
            const fc = result.response.candidates?.[0]?.content?.parts?.find(p => (p as any).functionCall)?.functionCall;

            if (!fc || fc.name !== 'researchRepo') {
                const err = 'Brain failed to generate a tool-based plan.';
                researchSpan.end({ output: { error: err, text: result.response.text ? result.response.text() : '' } });
                trace.end({ output: { status: 'FAILED', error: err } });
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

            researchSpan.end({ output: { proposal } });
            const finalRes: MomentumResult = { isStagnant: true, repoRef, daysSince, proposal, status: 'STAGNANT_PLANNING' };
            trace.end({ output: finalRes });
            await this.opik.flush();
            return finalRes;

        } catch (e: any) {
            console.error('[Core Error] plan failed:', e.message);
            trace.end({ output: { error: e.message } });
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
            console.log(`[Core] Executing Shadow PR on ${proposal.repoRef}...`);
            const sTitle = proposal.title.replace(/"/g, "'");
            const sBody = `${proposal.body}\n\nProposed Change:\n\`\`\`\n${proposal.codeChange}\n\`\`\``.replace(/"/g, "'");

            const url = execSync(`${GH_PATH} issue create -R ${proposal.repoRef} --title "${sTitle}" --body "${sBody}"`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

            const res: MomentumResult = {
                isStagnant: true,
                repoRef: proposal.repoRef,
                issueUrl: url,
                status: 'COMPLETE'
            };
            trace.end({ output: res });
            await this.opik.flush();
            return res;
        } catch (e: any) {
            console.error('[Core Error] execute failed:', e.message);
            trace.end({ output: { error: e.message } });
            await this.opik.flush();
            return { isStagnant: true, repoRef: proposal.repoRef, status: 'FAILED', error: e.message };
        }
    }
}
