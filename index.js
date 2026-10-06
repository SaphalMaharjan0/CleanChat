import 'dotenv/config';
import { Client, Events, GatewayIntentBits, Partials, REST, Routes } from 'discord.js';
import { commandsJSON } from './commands/registry.js';
import { onInteraction } from './events/interaction.js';
import { onMessage } from './events/spam.js';
import { onVoiceStateUpdate } from './events/voiceState.js';
import { createDistube } from './player.js';
import { startServer } from './server.js';
import { raid, startCleanupTimer } from './state.js';

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
});

client.on(Events.InteractionCreate, onInteraction);
client.on(Events.MessageCreate, onMessage);
client.on(Events.VoiceStateUpdate, onVoiceStateUpdate);

startCleanupTimer();
startServer(client, { getRaidMode: () => raid.active });

client.login(process.env.DISCORD_TOKEN);
