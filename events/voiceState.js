import { stayVoiceChannels } from '../state.js';

// Track the bot's own voice channel so 24/7 state stays accurate
export function onVoiceStateUpdate(oldState, newState) {
    const botId = newState.client.user.id;
    if (newState.member?.id !== botId && oldState.member?.id !== botId) return;

    const guildId = newState.guild.id;

    if (newState.channelId) {
        // Bot was moved to a different channel: follow it
        if (stayVoiceChannels.has(guildId)) stayVoiceChannels.set(guildId, newState.channelId);
        return;
    }

    // Bot was disconnected: clean up
    stayVoiceChannels.delete(guildId);
    console.log(`[VC] Bot disconnected from voice channel in ${newState.guild.name}.`);
}
