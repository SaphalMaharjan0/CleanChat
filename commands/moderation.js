import { PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { CONFIG } from '../config.js';
import { EPHEMERAL, purgeUserMessages, sendLog } from '../utils.js';

export const deleteMessage = {
    data: new SlashCommandBuilder()
        .setName('delete_message')
        .setDescription('Delete a specific number of recent messages from a user')
        .addUserOption(o => o.setName('user').setDescription('The user to delete messages from').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Number of messages to delete (max 100)'))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),

    async execute(interaction) {
        const target = interaction.options.getUser('user');
        const amount = Math.min(interaction.options.getInteger('amount') || 50, 100);

        await interaction.deferReply({ flags: EPHEMERAL });

        try {
            const deleted = await purgeUserMessages(interaction.channel, target.id, amount);
            if (!deleted) {
                return interaction.editReply(`No recent messages found from ${target.tag}.`);
            }
            await interaction.editReply(`Successfully deleted ${deleted} messages from ${target.tag}.`);
            await sendLog(
                interaction.guild,
                CONFIG.COMMANDS_CHANNEL_ID,
                `🗑️ **Command Executed**\n**Admin:** ${interaction.user.tag}\n**Action:** Deleted ${deleted} messages from ${target.tag} in <#${interaction.channel.id}>`,
            );
        } catch (error) {
            console.error('Error during purge:', error);
            await interaction.editReply('There was an error trying to purge messages.');
        }
    },
};
