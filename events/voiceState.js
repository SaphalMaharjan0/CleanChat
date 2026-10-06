import { stayVoiceChannels, setStayChannel, clearStayChannel } from '../state.js';

// guildId -> timeoutId
const reconnectLoops = new Map();

export async function onVoiceStateUpdate(oldState, newState) {
    const client = newState.client;
    // Only react to the bot's own voice state
    if (newState.id !== client.user.id) return;

    const guildId = newState.guild.id;

    if (newState.channelId) {
        // Connected. Stop any active reconnect loop.
        if (reconnectLoops.has(guildId)) {
            clearTimeout(reconnectLoops.get(guildId));
            reconnectLoops.delete(guildId);
        }
        // If the guild is meant to stay in VC, update the target channel so moves are followed
        if (stayVoiceChannels.has(guildId)) {
            setStayChannel(guildId, newState.channelId);
        }
        return;
    }

    // Bot was disconnected.
    console.log(`[VC] Bot disconnected from voice channel in ${newState.guild.name}.`);

    // If the guild is meant to stay, try rejoining with exponential backoff.
    if (stayVoiceChannels.has(guildId) && !reconnectLoops.has(guildId)) {
        console.log(`[VC] Attempting auto-reconnect for ${newState.guild.name}...`);
        startReconnectLoop(client, guildId, 2000);
    }
}

function startReconnectLoop(client, guildId, delay) {
    const timeoutId = setTimeout(async () => {
        reconnectLoops.delete(guildId);

        const targetChannelId = stayVoiceChannels.get(guildId);
        if (!targetChannelId) return; // /leave was used, abort quietly

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return; // Bot was removed from guild

        const channel = guild.channels.cache.get(targetChannelId) || await guild.channels.fetch(targetChannelId).catch(() => null);
        
        if (!channel || !channel.permissionsFor(client.user)?.has(['Connect', 'Speak'])) {
            console.log(`[VC] Channel ${targetChannelId} no longer exists or permissions missing in ${guild.name}. Dropping 24/7 status.`);
            clearStayChannel(guildId);
            return;
        }

        try {
            await client.distube.voices.join(channel);
            console.log(`[VC] Successfully reconnected to ${channel.name} in ${guild.name}.`);
        } catch (e) {
            console.error(`[VC] Reconnect failed in ${guild.name}. Retrying...`);
            startReconnectLoop(client, guildId, Math.min(delay * 2, 60000));
        }
    }, delay);
    reconnectLoops.set(guildId, timeoutId);
}
