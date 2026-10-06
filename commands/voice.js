import { PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { stayVoiceChannels } from '../state.js';
import { EPHEMERAL } from '../utils.js';

export const join = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Make the bot join your current voice channel and stay 24/7'),

    async execute(interaction) {
        const channel = interaction.member?.voice?.channel;
        if (!channel) {
            return interaction.reply({ content: '❌ You must be in a voice channel to use this command!', flags: EPHEMERAL });
        }
        try {
            await interaction.client.distube.voices.join(channel);
            stayVoiceChannels.set(interaction.guildId, channel.id);
            await interaction.reply(`🔊 Joined **${channel.name}**! I will stay in this channel 24/7 until disconnected by an admin with \`/leave\`.`);
        } catch (e) {
            await interaction.reply({ content: `❌ Failed to join voice channel: ${e.message}`, flags: EPHEMERAL });
        }
    },
};

export const leave = {
    data: new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Disconnect the bot from the voice channel (Admin only)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
        const { distube } = interaction.client;
        stayVoiceChannels.delete(interaction.guildId);
        if (!distube.voices.get(interaction.guildId)) {
            return interaction.reply({ content: '❌ I am not currently connected to any voice channel in this server.', flags: EPHEMERAL });
        }
        try {
            await distube.voices.leave(interaction.guildId);
            await interaction.reply('👋 Successfully disconnected from the voice channel.');
        } catch (e) {
            await interaction.reply({ content: `❌ Failed to disconnect: ${e.message}`, flags: EPHEMERAL });
        }
    },
};
