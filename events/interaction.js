import { commands } from '../commands/registry.js';
import { EPHEMERAL } from '../utils.js';

export async function onInteraction(interaction) {
    if (!interaction.isChatInputCommand() || !interaction.guild) return;

    console.log(`[💻 COMMAND] /${interaction.commandName} used by ${interaction.user.tag} in ${interaction.guild.name}`);

    const command = commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(`[Command Error] /${interaction.commandName}:`, error);
        const reply = { content: '❌ Something went wrong running that command.', flags: EPHEMERAL };
        if (interaction.deferred || interaction.replied) await interaction.followUp(reply).catch(() => {});
        else await interaction.reply(reply).catch(() => {});
    }
}
