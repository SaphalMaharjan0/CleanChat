import { MessageFlags } from 'discord.js';

export const EPHEMERAL = MessageFlags.Ephemeral;

// Send a message to a configured log channel (no-op if the ID is empty or invalid)
export async function sendLog(guild, channelId, content) {
    if (!channelId) return;
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;
    await channel.send(content).catch(err => console.error('Failed to send log message:', err));
}

// Delete a user's recent messages (looks at the last 100). Messages older than
// 14 days can't be bulk deleted, so they are removed one by one.
export async function purgeUserMessages(channel, userId, limit = 100) {
    const fetched = await channel.messages.fetch({ limit: 100 });
    const userMessages = [...fetched.filter(m => m.author.id === userId).values()].slice(0, limit);
    if (!userMessages.length) return 0;

    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recentIds = userMessages.filter(m => m.createdTimestamp > twoWeeksAgo).map(m => m.id);
    const oldMessages = userMessages.filter(m => m.createdTimestamp <= twoWeeksAgo);

    if (recentIds.length) await channel.bulkDelete(recentIds, true);
    for (const msg of oldMessages) await msg.delete().catch(() => {});

    return userMessages.length;
}
