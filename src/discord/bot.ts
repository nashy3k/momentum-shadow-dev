// 1. Initial Heartbeat
console.log('--- BOT PROCESS STARTING ---');

import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// EMERGENCY LOGGING (Bypass stdout buffering)
const EMERGENCY_LOG = '/dev/shm/momentum-debug.log';
const log = (msg: string) => {
    const entry = `${new Date().toISOString()}: ${msg}\n`;
    try { fs.appendFileSync(EMERGENCY_LOG, entry); } catch (e) { }
    console.log(msg);
};

log('[Bot] Startup Purge Initiated...');

// SIBLING PURGE: Kill any other tsx/bot.ts processes EXCEPT this process tree
try {
    const myPid = process.pid;
    // Find pids of other tsx processes running bot.ts
    const otherPids = execSync(`pgrep -f "src/discord/bot.ts"`, { encoding: 'utf-8' })
        .split('\n')
        .filter(p => p && parseInt(p) !== myPid && parseInt(p) !== process.ppid);

    if (otherPids.length > 0) {
        log(`[Bot] Found ${otherPids.length} ghost processes. Purging...`);
        otherPids.forEach(p => {
            try { execSync(`kill -9 ${p}`); } catch (e) { }
        });
    }
} catch (e) {
    // pgrep fails if no results, which is fine
}

dotenv.config({ override: true });

// 2. Global Logging Setup
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const getTimestamp = () => new Date().toISOString() + ': ';

console.log = (...args) => originalLog(getTimestamp(), ...args);
console.error = (...args) => originalError(getTimestamp(), ...args);
console.warn = (...args) => originalWarn(getTimestamp(), ...args);

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

// Schedule: TEST MODE -> 3 PM KL (7 AM UTC)
console.log('[Scheduler] Initializing Test Patrol (Scheduled for 3 PM KL)...');
cron.schedule('0 7 * * *', async () => {
    // Run at 07:00 UTC -> 15:00 (3 PM) KL Time
    console.log('[Scheduler] 🕗 It is 3 PM KL. Starting Scheduled Test Patrol...');
    await runPatrol();
});

async function runPatrol() {
    try {
        const repos = await engine.listRepos();
        console.log(`[Scheduler] Found ${repos.length} tracked repositories.`);

        for (const repoDoc of repos) {
            const r = repoDoc as any;
            const repoRef = r.repoRef || r.id;
            console.log(`[Scheduler] Checking pulse for ${repoRef}...`);

            // Re-run plan to see if still stagnant
            const result = await engine.plan(repoRef);

            if (result.isStagnant && result.proposal && r.discordChannelId) {
                console.log(`[Scheduler] 🚨 Stagnation found for ${repoRef}! Alerting Discord...`);

                try {
                    const channel = await client.channels.fetch(r.discordChannelId);
                    if (channel?.isTextBased()) {
                        const proposalId = Math.random().toString(36).substring(7);
                        pendingProposals.set(proposalId, result.proposal);

                        const embed = new EmbedBuilder()
                            .setColor(0x0099FF)
                            .setTitle('🚨 Nightly Patrol: Stagnation Detected!')
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

                        await (channel as any).send({ embeds: [embed], components: [row] });
                    }
                } catch (chErr) {
                    console.error(`[Scheduler] Failed to fetch channel ${r.discordChannelId}:`, chErr);
                }
            } else if (result.status === 'FAILED') {
                console.error(`[Scheduler] ❌ System Error for ${repoRef}: ${result.error}`);
            } else {
                console.log(`[Scheduler] Repository ${repoRef} is healthy (Last check: ${result.daysSince?.toFixed(1)} days ago).`);
                if (!r.discordChannelId) console.warn(`[Scheduler] ⚠️ Missing discordChannelId for ${repoRef}. Run /momentum check to repair.`);
            }
        }
    } catch (err) {
        console.error('[Scheduler] Patrol Failed:', err);
    }
}

async function runMaintenance() {
    console.log('[Maintenance] Starting full system sync (Skip LLM)...');
    const repos = await engine.listRepos();

    for (const repoDoc of repos) {
        const r = repoDoc as any;
        const repoRef = r.repoRef || r.id;
        console.log(`[Maintenance] Syncing ${repoRef}...`);

        try {
            await engine.plan(repoRef, { discordChannelId: r.discordChannelId }, { maintenanceOnly: true });
        } catch (err: any) {
            console.error(`[Maintenance] Sync failed for ${repoRef}:`, err.message);
        }
    }
    console.log('[Maintenance] System sync complete.');
}

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
const shutdown = () => {
    console.log('[Bot] Shutting down gracefully...');
    server.close(() => {
        client.destroy();
        process.exit(0);
    });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

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

    c.user.setPresence({
        activities: [{ name: 'Momentum Assistant', type: 3 }], // Type 3 is WATCHING
        status: 'online'
    });
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (interaction.isChatInputCommand()) {
        const cmdInteraction = interaction as ChatInputCommandInteraction;

        if (cmdInteraction.commandName === 'momentum') {
            const subcommand = cmdInteraction.options.getSubcommand();
            if (subcommand === 'check') {
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
                await cmdInteraction.deferReply({ ephemeral: true });

                const result = await engine.untrack(repoInput);
                if (result.success) {
                    await cmdInteraction.editReply(`🗑️ **Untracked**: ${repoInput} has been removed from monitoring and the dashboard.`);
                } else {
                    await cmdInteraction.editReply(`❌ **Failed to untrack**: ${result.error || 'Unknown Error'}`);
                }
            } else if (subcommand === 'link') {
                const email = cmdInteraction.options.getString('email')!.trim();
                await cmdInteraction.deferReply({ ephemeral: true });

                const result = await engine.linkAccount(cmdInteraction.user.id, email);
                if (result.success) {
                    await cmdInteraction.editReply(`🔗 **LinkedIn**: Your Discord account is now paired with \`${email}\`. Your dashboard will now show your Discord identity!`);
                } else {
                    await cmdInteraction.editReply(`❌ **Link Failed**: ${result.error || 'Unknown Error'}`);
                }
            } else if (subcommand === 'patrol') {
                await cmdInteraction.deferReply({ ephemeral: true });
                await cmdInteraction.editReply('🚀 **Manual Patrol Triggered.** Checking all tracked repositories for stagnation...');
                await runPatrol();
            } else if (subcommand === 'debug') {
                await cmdInteraction.deferReply({ ephemeral: true });
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
            if (proposalId && proposal) {
                // AUTO-LEARNING: Save human rejection as a "Negative Memory"
                engine.memory.addMemory(
                    `HUMAN REJECTION: User rejected proposal for ${proposal.repoRef}.\n` +
                    `Reason: Manual intervention.\n` +
                    `Proposed Change: ${proposal.description}`,
                    'negative',
                    proposal.repoRef
                ).then(() => {
                    console.log(`[Bot] Learning from human rejection: ${proposal.repoRef}`);
                }).catch(err => console.error('[Bot] Failed to save rejection memory:', err));

                pendingProposals.delete(proposalId);
            }
            await btnInteraction.update({
                content: '❌ **Proposal Rejected.** (Momentum has learned from this rejection 🧠)',
                components: [],
                embeds: btnInteraction.message.embeds
            });
        }
    }
});

client.login(token);
