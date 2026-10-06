import 'dotenv/config';
import { Client, Events, GatewayIntentBits, Partials, REST, Routes } from 'discord.js';
import { commandsJSON } from './commands/registry.js';
import { onInteraction } from './events/interaction.js';
import { onMessage } from './events/spam.js';
import { onVoiceStateUpdate } from './events/voiceState.js';
import { createDistube } from './player.js';
import { startServer } from './server.js';
import { raid, startCleanupTimer, loadStayChannels, stayVoiceChannels, clearStayChannel } from './state.js';

process.on('unhandledRejection', error => {
    console.error('[Unhandled Rejection]', error);
});

process.on('uncaughtException', error => {
    // Known @discordjs/voice race: a keep-alive ping fires just after the voice
    // connection was destroyed. It is harmless, so log it quietly.
    if (error?.code === 'ERR_SOCKET_DGRAM_NOT_RUNNING') {
        console.warn('[Voice] Ignored keep-alive on an already-closed voice socket.');
        return;
    }
    console.error('[Uncaught Exception]', error);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

client.distube = createDistube(client);

client.once(Events.ClientReady, async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    console.log('🛡️  CleanChat spam protection is active.');

    try {
        console.log('Started refreshing application (/) commands.');
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commandsJSON });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }

    loadStayChannels();
    for (const [guildId, channelId] of stayVoiceChannels) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            clearStayChannel(guildId);
            continue;
        }
        const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.permissionsFor(client.user)?.has(['Connect', 'Speak'])) {
            clearStayChannel(guildId);
            continue;
        }
        try {
            await client.distube.voices.join(channel);
            console.log(`[VC] Reconnected to ${channel.name} in ${guild.name} from saved state.`);
        } catch (e) {
            console.error(`[VC] Failed to auto-reconnect to ${guild.name} on boot:`, e);
        }
    }
});

client.on(Events.InteractionCreate, onInteraction);
client.on(Events.MessageCreate, onMessage);
client.on(Events.VoiceStateUpdate, onVoiceStateUpdate);

startCleanupTimer();
startServer(client, { getRaidMode: () => raid.active });

client.login(process.env.DISCORD_TOKEN);
