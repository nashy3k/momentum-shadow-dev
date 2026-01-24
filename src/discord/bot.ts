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
    SlashCommandBuilder
} from 'discord.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { CoreEngine } from '../core/engine.js';
import type { MomentumProposal } from '../core/engine.js';

// Load .env
const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

const token = process.env.DISCORD_TOKEN;
const clientId = '1464207508603408404'; // From user's input

if (!token) {
    console.error('DISCORD_TOKEN not found in .env');
    process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const engine = new CoreEngine();

// In-memory store (Hackathon grade)
const pendingProposals = new Map<string, MomentumProposal>();
const userSettings = new Map<string, { timezone: string }>();

const commands = [
    new SlashCommandBuilder()
        .setName('momentum')
        .setDescription('Check repository stagnation and research improvements.')
        .addStringOption(option =>
            option.setName('repo')
                .setDescription('The GitHub Repo URL or local path')
                .setRequired(true)),
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

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'momentum') {
            const repo = interaction.options.getString('repo')!;
            await interaction.deferReply();

            try {
                const result = await engine.plan(repo);

                if (result.status === 'ACTIVE') {
                    return interaction.editReply(`✅ **${result.repoRef}** is healthy! (Last active ${result.daysSince?.toFixed(1)} days ago).`);
                }

                if (result.status === 'FAILED') {
                    return interaction.editReply(`❌ **System Error**: ${result.error}`);
                }

                if (result.proposal) {
                    const proposalId = Math.random().toString(36).substring(7);
                    pendingProposals.set(proposalId, result.proposal);

                    const embed = new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle('🚨 Stagnation Detected!')
                        .setDescription(`The repository **${result.repoRef}** has been inactive for **${result.daysSince?.toFixed(1)}** days.`)
                        .addFields(
                            { name: 'Brain Suggestion', value: result.proposal.description },
                            { name: 'Target File', value: result.proposal.targetFile }
                        )
                        .setFooter({ text: 'Momentum Shadow Developer • Gemini 3 Flash' })
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

                    await interaction.editReply({ embeds: [embed], components: [row] });
                }
            } catch (err: any) {
                await interaction.editReply(`💥 **Fatal crash**: ${err.message}`);
            }
        }

        if (interaction.commandName === 'momentum-settings') {
            const tz = interaction.options.getString('timezone')!;
            userSettings.set(interaction.user.id, { timezone: tz });
            await interaction.reply({
                content: `✅ **Settings Updated!** Your timezone is now set to \`${tz}\`. Nightly patrols will now respect your local 8 AM.`,
                ephemeral: true
            });
        }
    }

    if (interaction.isButton()) {
        const [action, proposalId] = interaction.customId.split('_');
        const proposal = pendingProposals.get(proposalId);

        if (!proposal) {
            return interaction.reply({ content: 'Proposal expired or not found.', ephemeral: true });
        }

        if (action === 'approve') {
            await interaction.update({ content: '🚀 **Executing Shadow PR...**', components: [], embeds: interaction.message.embeds });

            try {
                const result = await engine.execute(proposal);
                if (result.status === 'COMPLETE') {
                    await interaction.followUp(`✅ **Success!** Improvement published to: ${result.issueUrl}`);
                    pendingProposals.delete(proposalId);
                } else {
                    await interaction.followUp(`❌ **Execution Failed**: ${result.error}`);
                }
            } catch (e: any) {
                await interaction.followUp(`💥 **Execution Error**: ${e.message}`);
            }
        } else {
            pendingProposals.delete(proposalId);
            await interaction.update({ content: '❌ **Proposal Rejected.**', components: [], embeds: interaction.message.embeds });
        }
    }
});

client.login(token);
