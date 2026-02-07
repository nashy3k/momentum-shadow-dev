// 1. Initial Heartbeat
console.log('--- BOT PROCESS STARTING ---');

import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { getFirestore, FieldValue, Firestore } from 'firebase-admin/firestore';
import { MemoryManager } from '../core/memory.js';

// EMERGENCY LOGGING (Bypass stdout buffering)
const EMERGENCY_LOG = '/dev/shm/momentum-debug.log';
const log = (msg: string) => {
    const entry = `${new Date().toISOString()}: ${msg}\n`;
    try { fs.appendFileSync(EMERGENCY_LOG, entry); } catch (e) { }
    console.log(msg);
};

log(`[Bot] PID: ${process.pid} | Parent PID: ${process.ppid}`);

dotenv.config({ override: true });

// 2. Global Logging Setup
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const getTimestamp = () => new Date().toISOString() + ': ';

console.log = (...args) => {
    const msg = getTimestamp() + args.map(a => String(a)).join(' ');
    try { fs.appendFileSync(EMERGENCY_LOG, msg + '\n'); } catch (e) { }
    originalLog(msg);
};
console.error = (...args) => {
    const msg = getTimestamp() + '[ERROR] ' + args.map(a => String(a)).join(' ');
    try { fs.appendFileSync(EMERGENCY_LOG, msg + '\n'); } catch (e) { }
    originalError(msg);
};
console.warn = (...args) => {
    const msg = getTimestamp() + '[WARN] ' + args.map(a => String(a)).join(' ');
    try { fs.appendFileSync(EMERGENCY_LOG, msg + '\n'); } catch (e) { }
    originalWarn(msg);
};

log('[Bot] 💓 HEARTBEAT: Logging system ready.');

// 3. Early Error Catching
process.on('uncaughtException', (err) => {
    log(`[(CRITICAL) Uncaught Exception] The bot crashed: ${err.message}`);
    console.error(err);
});
process.on('unhandledRejection', (reason, promise) => {
    log(`[(CRITICAL) Unhandled Rejection] at: ${promise} reason: ${reason}`);
});

// 4. Imports
import {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events,
    REST,
    Routes,
    SlashCommandBuilder,
    type Interaction,
    type ChatInputCommandInteraction,
    type ButtonInteraction
} from 'discord.js';
import { CoreEngine } from '../core/engine.js';
import type { MomentumProposal } from '../core/engine.js';
import * as cron from 'node-cron';

console.log('[Bot] 📦 Modules loaded.');

const token = process.env.DISCORD_TOKEN;
const clientId = '1464207508603408404';

if (!token) {
    console.error('DISCORD_TOKEN not found in .env');
    process.exit(1);
}

// 5. Global Instances
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const engine = new CoreEngine();

console.log('[Bot] 🛠️ Instances created and Engine initialized.');

// In-memory store (Hackathon grade)
const pendingProposals = new Map<string, MomentumProposal>();

// Schedule: Default 8 AM UTC (4 PM KL). User settings can override this.
// For Hackathon, we'll keep it simple and just run the check for the main repo every day at 00:00 UTC (8 AM KL).
// Real implementation would read from DB for per-user schedules.

// Schedule: DEFAULT -> 8:00 AM KL (00:00 UTC)
console.log('[Scheduler] Initializing Daily Patrol (Scheduled for 8:00 AM KL)...');
cron.schedule('0 0 * * *', async () => {
    // START HACKATHON TOGGLE
    if (process.env.ENABLE_DAILY_PATROL === 'false') {
        console.log('[Scheduler] ⏸️ Daily Patrol SKIPPED (ENABLE_DAILY_PATROL=false)');
        return;
    }
    // END HACKATHON TOGGLE

    // Run at 00:00 UTC -> 08:00 AM KL Time
    console.log('[Scheduler] 🕗 It is 8:00 AM KL. Starting Scheduled Patrol...');
    await runPatrol();
});

// [REMOVED DUPLICATE ROUTINES]
// The canonical implementations are now at the bottom of the file to ensure they use the correct scope.

const commands = [
    new SlashCommandBuilder()
        .setName('momentum')
        .setDescription('Momentum Shadow Developer')
        .addSubcommand(sub =>
            sub.setName('check')
                .setDescription('Check repository for stagnation')
                .addStringOption(opt => opt.setName('repo').setDescription('The GitHub Repo URL or local path').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('untrack')
                .setDescription('Remove a repository from monitoring')
                .addStringOption(opt => opt.setName('repo').setDescription('The GitHub Repo URL or local path').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('link')
                .setDescription('Link your Discord ID to your Dashboard email')
                .addStringOption(opt => opt.setName('email').setDescription('The email you use to login to the Dashboard').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('patrol')
                .setDescription('Manually trigger an 8 AM-style nightly patrol for all tracked repos')
        )
        .addSubcommand(sub =>
            sub.setName('debug')
                .setDescription('Perform a fast, low-cost maintenance sync of all repos (Skips LLM)')
        ),
    new SlashCommandBuilder()
        .setName('momentum-settings')
        .setDescription('Configure your Shadow Developer preferences.')
        .addStringOption(option =>
            option.setName('timezone')
                .setDescription('Set your timezone (e.g., Asia/Kuala_Lumpur)')
                .setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

import * as http from 'http';

// KEEPALIVE: Fake Web Service to trick Zo Computer into staying awake
// This allows us to use UptimeRobot to ping the service every 5 minutes.
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Momentum Bot is Alive! 🤖');
});

server.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
        console.warn(`[KeepAlive] Port ${PORT} is already in use. The bot will continue, but the health check may fail if owned by a zombie process.`);
    } else {
        console.error(`[KeepAlive] Server error:`, e);
    }
});

server.listen(PORT, () => {
    console.log(`[KeepAlive] HTTP Server listening on port ${PORT}`);
});

// Graceful Shutdown: Ensure the port is released when the process dies
// Graceful Shutdown: Ensure the port is released when the process dies
const shutdown = async (signal: string) => {
    console.log(`[Bot] Shutting down gracefully (${signal})...`);

    // LAST GASP: Try to alert Discord
    try {
        const adminChannel = client.channels.cache.find(c =>
            (c as any).name === 'command-center' || (c as any).name === 'admin-logs' || (c as any).name === 'momentum-admin'
        );
        if (adminChannel?.isTextBased()) {
            await (adminChannel as any).send(`🔴 **Momentum Bot is going offline.** (Signal: ${signal})`);
            console.log('[Bot] Sent offline alert.');
        }
    } catch (err) {
        console.error('[Bot] Failed to send offline alert:', err);
    }

    server.close(() => {
        client.destroy();
        process.exit(0);
    });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

client.once(Events.ClientReady, c => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
    console.log(`Joined Guilds: ${c.guilds.cache.map(g => g.name).join(', ') || 'NONE'}`);

    if (c.user.id !== clientId) {
        console.error(`[CRITICAL] Client ID Mismatch! Hardcoded: ${clientId} vs Token: ${c.user.id}`);
        console.error('Commands registered with the wrong ID will NOT work!');
    }

    c.user.setPresence({
        activities: [{ name: 'Momentum Assistant', type: 3 }], // Type 3 is WATCHING
        status: 'online'
    });

    // Start Patron Request Listener
    watchPatronRequests();
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    console.log(`[Bot] ⚡ Interaction received: ${interaction.type} | ID: ${interaction.id}`);

    if (interaction.isChatInputCommand()) {
        const cmdInteraction = interaction as ChatInputCommandInteraction;
        // ACKNOWLEDGE IMMEDIATELY to prevent "Unknown interaction" (3s timeout)
        const sub = cmdInteraction.options.getSubcommand(false);

        // Safeguard Acknowledgement
        if (sub !== 'check') {
            try {
                console.log(`[Bot] Acknowledging command '${sub}'...`);

                // FORCE TIMEOUT: If Discord doesn't ack in 5s, fail.
                const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('DeferReply Timed Out')), 5000));
                const ack = cmdInteraction.deferReply({ ephemeral: true });

                await Promise.race([ack, timeout]);
                console.log(`[Bot] Acknowledgement SUCCESS for '${sub}'.`); // CHECKPOINT 1
            } catch (err: any) {
                console.warn(`[Bot] Failed to acknowledge interaction: ${err.message}`);
                return;
            }
        }

        if (cmdInteraction.commandName === 'momentum') {
            const subcommand = cmdInteraction.options.getSubcommand();
            console.log(`[Bot] Routing subcommand: '${subcommand}'`); // CHECKPOINT 2

            if (subcommand === 'check') {
                const repoInput = cmdInteraction.options.getString('repo')!.trim();
                // ... (check logic) ...
                if (repoInput.toLowerCase().includes('check!') || repoInput.toLowerCase() === 'check') {
                    return cmdInteraction.reply({
                        content: '❌ **Tip**: You don\'t need to type "check!". Just paste your repository URL in the "repo" box.\n\n**Example**: `/momentum check repo:https://github.com/nashy3k/vector-skylab`',
                        ephemeral: true
                    });
                }
                const repo = repoInput;
                await cmdInteraction.deferReply();

                try {
                    const result = await engine.plan(repo, { discordChannelId: cmdInteraction.channelId });
                    // ... (rest of check logic) ...
                    if (result.status === 'ACTIVE') {
                        return cmdInteraction.editReply(`✅ **${result.repoRef}** is healthy! (Last active ${result.daysSince?.toFixed(1)} days ago).`);
                    }
                    if (result.status === 'FAILED') {
                        return cmdInteraction.editReply(`❌ **System Error**: ${result.error || 'Unknown Error'}`);
                    }
                    // ...
                } catch (err: any) {
                    await cmdInteraction.editReply(`💥 **Fatal crash**: ${err.message || 'An unknown error occurred.'}`);
                }
            } else if (subcommand === 'patrol') {
                console.log('[Bot] Entering PATROL block...'); // CHECKPOINT 3
                await cmdInteraction.editReply('🚀 **Manual Patrol Triggered.** Checking all tracked repositories for stagnation...');
                console.log('[Bot] Triggering runPatrol()...'); // CHECKPOINT 4
                await runPatrol();
                console.log('[Bot] runPatrol() returned.'); // CHECKPOINT 5
            } else if (subcommand === 'track') {
                const repoInput = cmdInteraction.options.getString('repo')!.trim();

                // Hard check for common "command as argument" mistakes
                if (repoInput.toLowerCase().includes('check!') || repoInput.toLowerCase() === 'check') {
                    return cmdInteraction.reply({
                        content: '❌ **Tip**: You don\'t need to type "check!". Just paste your repository URL in the "repo" box.\n\n**Example**: `/momentum check repo:https://github.com/nashy3k/vector-skylab`',
                        ephemeral: true
                    });
                }
                const repo = repoInput;

                await cmdInteraction.deferReply();

                try {
                    const result = await engine.plan(repo, { discordChannelId: cmdInteraction.channelId });

                    if (result.status === 'ACTIVE') {
                        return cmdInteraction.editReply(`✅ **${result.repoRef}** is healthy! (Last active ${result.daysSince?.toFixed(1)} days ago).`);
                    }

                    if (result.status === 'FAILED') {
                        return cmdInteraction.editReply(`❌ **System Error**: ${result.error || 'Unknown Error'}`);
                    }

                    if (result.proposal) {
                        const proposalId = Math.random().toString(36).substring(7);
                        pendingProposals.set(proposalId, result.proposal);

                        const embed = new EmbedBuilder()
                            .setColor(0x0099FF)
                            .setTitle('🚨 Stagnation Detected!')
                            .setDescription(`The repository **${result.repoRef}** has been inactive for **${result.daysSince?.toFixed(1) || '3+'}** days.`)
                            .addFields(
                                { name: 'Brain Suggestion', value: result.proposal.description },
                                { name: 'Target File', value: result.proposal.targetFile }
                            );

                        if (result.evaluation) {
                            const badge = result.evaluation.score >= 9 ? '🟢' : result.evaluation.score >= 7 ? '🟡' : '🔴';
                            embed.addFields({
                                name: `${badge} Senior Dev Confidence (${result.evaluation.score}/10)`,
                                value: result.evaluation.reasoning
                            });
                        }
                        embed.setFooter({ text: 'Momentum Shadow Developer • Gemini 3 Flash' })
                            .setTimestamp();

                        const row = new ActionRowBuilder<ButtonBuilder>()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`approve_${proposalId}`)
                                    .setLabel('Approve & Push')
                                    .setStyle(ButtonStyle.Success),
                                new ButtonBuilder()
                                    .setCustomId(`reject_${proposalId}`)
                                    .setLabel('Reject')
                                    .setStyle(ButtonStyle.Danger),
                            );

                        await cmdInteraction.editReply({ embeds: [embed], components: [row] });
                    }
                } catch (err: any) {
                    await cmdInteraction.editReply(`💥 **Fatal crash**: ${err.message || 'An unknown error occurred.'}`);
                }
            } else if (subcommand === 'untrack') {
                const repoInput = cmdInteraction.options.getString('repo')!.trim();

                const result = await engine.untrack(repoInput);
                if (result.success) {
                    await cmdInteraction.editReply(`🗑️ **Untracked**: ${repoInput} has been removed from monitoring and the dashboard.`);
                } else {
                    await cmdInteraction.editReply(`❌ **Failed to untrack**: ${result.error || 'Unknown Error'}`);
                }
            } else if (subcommand === 'link') {
                const email = cmdInteraction.options.getString('email')!.trim();

                const result = await engine.linkAccount(cmdInteraction.user.id, email);
                if (result.success) {
                    await cmdInteraction.editReply(`🔗 **LinkedIn**: Your Discord account is now paired with \`${email}\`. Your dashboard will now show your Discord identity!`);
                } else {
                    await cmdInteraction.editReply(`❌ **Link Failed**: ${result.error || 'Unknown Error'}`);
                }
                await cmdInteraction.editReply('🚀 **Manual Patrol Triggered.** Checking all tracked repositories for stagnation...');
                await runPatrol();
            } else if (subcommand === 'debug') {
                await cmdInteraction.editReply('🔧 **Maintenance Mode Activated.** Syncing dashboard metadata for all repositories (LLM skipped)...');
                await runMaintenance();
                await cmdInteraction.editReply('✅ **Sync Complete.** All tracked repositories have been refreshed on the dashboard.');
            }
        }

        if (cmdInteraction.commandName === 'momentum-settings') {
            const tz = cmdInteraction.options.getString('timezone')!;
            // For now, we just acknowledge. In a real app, we'd save this to Firestore user settings.
            // userSettings.set(cmdInteraction.user.id, { timezone: tz });
            await cmdInteraction.reply({
                content: `✅ **Settings Updated!** Your timezone is now set to \`${tz}\`. Nightly patrols will run at 8 AM ${tz}.`,
                ephemeral: true
            });
        }
    }

    if (interaction.isButton()) {
        const btnInteraction = interaction as ButtonInteraction;
        const [action, proposalId] = btnInteraction.customId.split('_');
        if (!proposalId) {
            return btnInteraction.reply({ content: 'Invalid interaction.', ephemeral: true });
        }
        const proposal = pendingProposals.get(proposalId);

        if (!proposal) {
            return btnInteraction.reply({ content: 'Proposal expired or not found.', ephemeral: true });
        }

        if (action === 'approve') {
            console.log(`[Bot] Approval received for ${proposal.repoRef}. Passing to Engine...`);
            await btnInteraction.update({
                content: '🚀 **Executing Shadow PR...**',
                components: [],
                embeds: btnInteraction.message.embeds
            });

            try {
                const result = await engine.execute(proposal);

                if (result.status === 'COMPLETE' && result.issueUrl) {
                    // Try to recover confidence score from the original embed
                    const oldEmbed = btnInteraction.message.embeds[0];
                    const confidenceField = oldEmbed?.fields.find(f => f.name.includes('Confidence'));
                    const confidenceText = confidenceField ? confidenceField.value : '🛡️ High';

                    const successEmbed = new EmbedBuilder()
                        .setTitle('🚀 Shadow PR Executed')
                        .setDescription(`The proposed changes have been pushed to GitHub.`)
                        .setURL(result.issueUrl)
                        .setColor('#10b981') // Green
                        .addFields(
                            { name: 'Target Repo', value: `\`${proposal.repoRef}\``, inline: true },
                            { name: 'Senior Dev Approval', value: confidenceText, inline: true },
                            { name: 'GitHub Link', value: `[View Issue](${result.issueUrl})` }
                        )
                        .setTimestamp();

                    await btnInteraction.editReply({
                        content: `✅ **Approved!** Issue created: ${result.issueUrl}`,
                        components: [],
                        embeds: [successEmbed]
                    });
                } else {
                    await btnInteraction.editReply({
                        content: `❌ **Execution Failed:** ${result.error || 'Unknown Error'}`,
                        components: [],
                        embeds: []
                    });
                }
            } catch (e: any) {
                console.error('[Bot Error] Execution:', e.message);
                await btnInteraction.followUp({
                    content: `❌ **System Error:** ${e.message || 'An unknown error occurred.'}`,
                    ephemeral: true
                });
            }
        } else {
            // Update proposal status in history
            if (proposal.originTraceId) {
                (async () => {
                    const snap = await (engine as any).db.collection('proposals')
                        .where('originTraceId', '==', proposal.originTraceId)
                        .limit(1)
                        .get();
                    if (!snap.empty) {
                        await snap.docs[0].ref.update({
                            status: 'REJECTED',
                            updatedAt: FieldValue.serverTimestamp()
                        });
                    }

                    // Send Opik Feedback
                    await engine.updateOpikFeedback(proposal.originTraceId!, 0.0, 'rejection');
                })().catch(err => console.error('[Bot] Failed to update rejection status:', err));
            }

            pendingProposals.delete(proposalId);
            await btnInteraction.update({
                content: '❌ **Proposal Rejected.** (Momentum has learned from this rejection 🧠)',
                components: [],
                embeds: btnInteraction.message.embeds as any
            });
        }

        // Handle Patron Requests
        if (action === 'approve' && btnInteraction.customId.includes('_patron_')) {
            const requestId = btnInteraction.customId.split('_patron_')[1];
            await btnInteraction.update({ content: '⚙️ **Processing Patron Request...**', components: [] });

            try {
                const snap = await (engine as any).db.collection('patron_requests').doc(requestId).get();
                if (!snap.exists) return btnInteraction.editReply('❌ Request not found.');

                const data = snap.data();
                const result = await engine.monitorRepo(data.repoRef, btnInteraction.channelId);

                await snap.ref.update({ status: 'APPROVED', updatedAt: FieldValue.serverTimestamp() });

                await btnInteraction.editReply({
                    content: `✅ **Patronage Accepted!** Now monitoring: **${result.repoRef}**.`,
                    embeds: btnInteraction.message.embeds
                });
            } catch (err: any) {
                await btnInteraction.editReply(`❌ **Failed to approve:** ${err.message}`);
            }
        }

        if (action === 'reject' && btnInteraction.customId.includes('_patron_')) {
            const requestId = btnInteraction.customId.split('_patron_')[1];
            await (engine as any).db.collection('patron_requests').doc(requestId).update({
                status: 'REJECTED',
                updatedAt: FieldValue.serverTimestamp()
            });
            await btnInteraction.update({ content: '🚫 **Patron Request Deflected.**', components: [], embeds: [] });
        }
    }
});

// --- MISSING ROUTINES RESTORED ---

async function runPatrol() {
    console.log('[Bot] 🛡️ PATROL STARTED manually.');
    try {
        const repos = await engine.listRepos();
        console.log(`[Bot] Found ${repos.length} repos to check.`);

        if (repos.length === 0) {
            console.warn('[Bot] ⚠️ No repos found in DB. Use /momentum track to add one.');
        }

        for (const repoDoc of repos) {
            const repo = repoDoc as any;
            const repoRef = repo.repoRef || repo.id;
            // Only patrol if it has a discord channel connected
            if (repo.discordChannelId) {
                console.log(`[Bot] Patrolling ${repoRef}...`);
                const fakeJob = { repoRef, discordChannelId: repo.discordChannelId, id: 'manual-run' };
                // Call the scheduler's logic manually
                // We reuse the logic inside the cron job by extracting it or just calling engine.plan directly
                const result = await engine.plan(repoRef);
                if (result.isStagnant && result.proposal) {
                    // We need to fetch the channel and send the embed, same as the cron job
                    const channel = await client.channels.fetch(repo.discordChannelId);
                    if (channel?.isTextBased()) {
                        const proposalId = Math.random().toString(36).substring(7);
                        pendingProposals.set(proposalId, result.proposal);
                        const embed = new EmbedBuilder()
                            .setColor(0x0099FF)
                            .setTitle('🚨 Manual Patrol: Stagnation Detected!')
                            .setDescription(`The repository **${result.repoRef}** has been inactive for **${result.daysSince?.toFixed(1) || '3+'}** days.`)
                            .addFields(
                                { name: 'Brain Suggestion', value: result.proposal.description },
                                { name: 'Target File', value: result.proposal.targetFile }
                            )
                            .setFooter({ text: 'Momentum Shadow Developer • Gemini 3 Flash' });

                        const row = new ActionRowBuilder<ButtonBuilder>()
                            .addComponents(
                                new ButtonBuilder().setCustomId(`approve_${proposalId}`).setLabel('Approve & Push').setStyle(ButtonStyle.Success),
                                new ButtonBuilder().setCustomId(`reject_${proposalId}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
                            );

                        await (channel as any).send({ embeds: [embed], components: [row] });
                        console.log(`[Bot] Alert sent to channel for ${repoRef}`);
                    }
                } else {
                    console.log(`[Bot] ${repoRef} is active or healthy.`);
                }
            }
        }
    } catch (e: any) {
        console.error('[Bot] Patrol failed:', e.message);
    }
}

async function runMaintenance() {
    console.log('[Bot] 🔧 MAINTENANCE STARTED.');
    try {
        const repos = await engine.listRepos();
        for (const repoDoc of repos) {
            const repo = repoDoc as any;
            const repoRef = repo.repoRef || repo.id;
            console.log(`[Bot] Syncing metadata for ${repoRef}...`);
            await engine.plan(repoRef, { discordChannelId: repo.discordChannelId }, { maintenanceOnly: true });
        }
    } catch (e) {
        console.error('[Bot] Maintenance failed:', e);
    }
}

async function watchPatronRequests() {
    log('[Bot] 🛡️ Starting Patron Request Listener...');
    const db = (engine as any).db as Firestore;
    if (!db) return;

    db.collection('patron_requests').where('status', '==', 'PENDING').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
            if (change.type === 'added') {
                const data = change.doc.data();
                const requestId = change.doc.id;

                log(`[Bot] New Patron Request: ${data.repoRef}`);

                // Find admin channel (#command-center or similar)
                const adminChannel = client.channels.cache.find(c =>
                    (c as any).name === 'command-center' || (c as any).name === 'admin-logs' || (c as any).name === 'momentum-admin'
                );

                if (adminChannel?.isTextBased()) {
                    const embed = new EmbedBuilder()
                        .setColor('#6366f1')
                        .setTitle('📥 New Patronage Request')
                        .setDescription(`A guest has requested a Momentum patrol for: **${data.repoRef}**`)
                        .addFields(
                            { name: 'Repository', value: `\`${data.repoRef}\`` },
                            { name: 'Requested At', value: data.requestedAt || 'Unknown' }
                        )
                        .setTimestamp()
                        .setFooter({ text: 'Momentum | Community Request' });

                    const row = new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`approve_patron_${requestId}`)
                                .setLabel('Accept Request')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`reject_patron_${requestId}`)
                                .setLabel('Deflect')
                                .setStyle(ButtonStyle.Secondary)
                        );

                    await (adminChannel as any).send({ embeds: [embed], components: [row] });
                } else {
                    log('[Bot] ⚠️ Could not find an admin channel (#command-center) for patronage alert.');
                }
            }
        });
    });
}

client.login(token);
