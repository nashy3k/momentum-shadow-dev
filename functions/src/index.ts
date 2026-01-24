import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { CoreEngine } from "./core/engine.js";
import * as dotenv from "dotenv";

// Load env for local emulator; in prod, use Secret Manager
dotenv.config();

const engine = new CoreEngine();

/**
 * Manual Trigger for a specific repo.
 */
export const pulseRepo = onRequest(async (req, res) => {
    const repo = (req.query.repo as string) || "https://github.com/nashy3k/autism-comm-cards";
    console.log(`[Cloud] Pulsing repo: ${repo}`);

    try {
        const result = await engine.plan(repo);
        // In a real hackathon app, this would send a Discord notification here
        // If stagnation detected.
        res.json({ success: true, result });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * Nightly Patrol: Runs every day at 8 AM.
 */
export const nightlyPatrol = onSchedule("0 8 * * *", async (event) => {
    // List of repos to monitor
    const repos = ["https://github.com/nashy3k/autism-comm-cards"];

    for (const repo of repos) {
        try {
            const result = await engine.plan(repo);
            if (result.isStagnant) {
                console.log(`[Patrol] Repo ${repo} is stagnant. Proposal generated.`);
                // Here you would trigger the Discord notification
            }
        } catch (e) {
            console.error(`[Patrol] Failed for ${repo}:`, e);
        }
    }
});
