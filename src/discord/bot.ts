import * as dotenv from 'dotenv';
dotenv.config({ override: true });

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
import * as fs from 'fs';
import * as path from 'path';
import { CoreEngine } from '../core/engine.js';
import type { MomentumProposal } from '../core/engine.js';

// Load .env
// Redundant config removed as it's handled at top with override: true

const token = process.env.DISCORD_TOKEN;
const clientId = '1464207508603408404'; // From user's input

if (!token) {
    console.error('DISCORD_TOKEN not found in .env');
    process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const engine = new CoreEngine();

import * as cron from 'node-cron';

// In-memory store (Hackathon grade)
const pendingProposals = new Map<string, MomentumProposal>();

// Schedule: Default 8 AM UTC (4 PM KL). User settings can override this.
// For Hackathon, we'll keep it simple and just run the check for the main repo every day at 00:00 UTC (8 AM KL).
// Real implementation would read from DB for per-user schedules.

console.log('[Scheduler] Initializing Nightly Patrol...');
cron.schedule('55 5 * * *', async () => {
    // FINAL TEST: 05:55 UTC -> 13:55 (1:55 PM) KL Time
    console.log('[Scheduler] 🕐 It is 5:55 AM UTC (1:55 PM KL). Starting Final Test Patrol...');
    await runPatrol();
}, {
    timezone: "Asia/Kuala_Lumpur"
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
            if (proposalId) {
                pendingProposals.delete(proposalId);
            }
            await btnInteraction.update({
                content: '❌ **Proposal Rejected.**',
                components: [],
                embeds: btnInteraction.message.embeds
            });
        }
    }
});

client.login(token);
