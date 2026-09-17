require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require('discord.js');

// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
    // Spam Thresholds
    RATE_LIMIT_WINDOW_MS: 5000,     // Time window for rate limit (5 seconds)
    RATE_LIMIT_MAX_MESSAGES: 5,     // Max messages allowed in the time window
    DUPLICATE_MESSAGE_WINDOW_MS: 10000, // Time window to check for duplicates
    MAX_DUPLICATE_MESSAGES: 3,      // Max exact duplicate messages allowed
    MAX_MENTIONS: 4,                // Max user/role mentions per message
    MAX_LINKS: 3,                   // Max HTTP links per message

    // Moderation Settings
    VIOLATIONS_BEFORE_TIMEOUT: 3,   // Number of spam violations before issuing a timeout
    TIMEOUT_DURATION_MS: 60 * 60 * 1000, // Timeout duration (1 hour in milliseconds)
    LOG_CHANNEL_ID: '',             // ID of the channel to send logs to (leave empty to disable)
    COMMANDS_CHANNEL_ID: '',        // ID of the channel to send command logs to
    EXEMPT_ROLES: [],               // Array of Role IDs that are exempt from spam checks
};

// ==========================================
// BOT SETUP
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

// Memory storage for user activity
const userActivity = new Map();

// Helper to get or create user data
function getUserData(userId) {
    if (!userActivity.has(userId)) {
        userActivity.set(userId, {
            messages: [],       // Stores timestamps for rate limit
            duplicates: [],     // Stores message objects for duplicate check
            violations: 0       // Tracks number of violations
        });
    }
    return userActivity.get(userId);
}

// Clean up old data to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    for (const [userId, data] of userActivity.entries()) {
        data.messages = data.messages.filter(time => now - time < CONFIG.RATE_LIMIT_WINDOW_MS);
        data.duplicates = data.duplicates.filter(msg => now - msg.createdTimestamp < CONFIG.DUPLICATE_MESSAGE_WINDOW_MS);
        
        // Remove user from map if they have no recent activity and no violations
        if (data.messages.length === 0 && data.duplicates.length === 0 && data.violations === 0) {
            userActivity.delete(userId);
        }
    }
}, Math.max(CONFIG.RATE_LIMIT_WINDOW_MS, CONFIG.DUPLICATE_MESSAGE_WINDOW_MS));


client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    console.log(`🛡️  CleanChat spam protection is active.`);
});

client.on('messageCreate', async (message) => {
    // Ignore bots and webhooks
    if (message.author.bot || message.webhookId) return;
    // Ignore DMs
    if (!message.guild) return;

    // ==========================================
    // COMMANDS
    // ==========================================
    if (message.content.startsWith('/delete message')) {
        if (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            await message.reply('You do not have permission to use this command.');
            return;
        }

        const args = message.content.split(' ').slice(2);
        const targetUser = message.mentions.users.first() || client.users.cache.get(args[0]);
        
        if (!targetUser) {
            await message.reply('Please specify a user. Usage: `/delete message @user [amount]`');
            return;
        }

        let amount = parseInt(args[1]) || 50;
        if (amount > 100) amount = 100;

        try {
            const fetched = await message.channel.messages.fetch({ limit: 100 });
            const userMessages = Array.from(fetched.filter(m => m.author.id === targetUser.id).values()).slice(0, amount);
            
            if (userMessages.length > 0) {
                const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
                const recentMessageIds = userMessages.filter(m => m.createdTimestamp > twoWeeksAgo).map(m => m.id);
                const oldMessages = userMessages.filter(m => m.createdTimestamp <= twoWeeksAgo);

                if (recentMessageIds.length > 0) {
                    await message.channel.bulkDelete(recentMessageIds, true);
                }

                // Delete older messages one by one to bypass the 14-day Discord limit
                for (const msg of oldMessages) {
                    await msg.delete().catch(() => {});
                }

                await message.reply(`Successfully deleted ${userMessages.length} messages from ${targetUser.tag}.`);
                
                // Log to commands channel
                if (CONFIG.COMMANDS_CHANNEL_ID) {
                    const cmdChannel = message.guild.channels.cache.get(CONFIG.COMMANDS_CHANNEL_ID);
                    if (cmdChannel) {
                        await cmdChannel.send(`🗑️ **Command Executed**\n**Admin:** ${message.author.tag}\n**Action:** Deleted ${userMessages.length} messages from ${targetUser.tag} in <#${message.channel.id}>`);
                    }
                }
            } else {
                await message.reply(`No recent messages found from ${targetUser.tag}.`);
            }
        } catch (error) {
            console.error('Error during purge:', error);
            await message.reply('There was an error trying to purge messages.');
        }
        // Don't process this command message further in spam checks
        return; 
    }

    // ==========================================
    // EXEMPTIONS
    // ==========================================
    // Check if user has "Manage Messages" permission
    if (message.member && message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return;
    }
    // Check if user has an exempt role
    if (message.member && CONFIG.EXEMPT_ROLES.some(roleId => message.member.roles.cache.has(roleId))) {
        return;
    }

    const userData = getUserData(message.author.id);
    const now = Date.now();
    let isSpam = false;
    let reason = '';

    // ==========================================
    // SPAM CHECKS
    // ==========================================

    // 1. Mass Mentions
    const mentionCount = message.mentions.users.size + message.mentions.roles.size;
    if (mentionCount > CONFIG.MAX_MENTIONS) {
        isSpam = true;
        reason = 'Mass Mentions';
    }

    // 2. Excessive Links & Discord Invites
    const linkRegex = /https?:\/\/[^\s]+/g;
    const inviteRegex = /(discord\.gg\/|discord\.com\/invite\/)[^\s]+/gi;
    
    if (inviteRegex.test(message.content)) {
        isSpam = true;
        reason = 'Discord Invite Link';
    } else {
        const links = message.content.match(linkRegex);
        if (links && links.length > CONFIG.MAX_LINKS) {
            isSpam = true;
            reason = 'Excessive Links';
        }
    }

    // 3. Rate Spam
    userData.messages.push(now);
    userData.messages = userData.messages.filter(time => now - time < CONFIG.RATE_LIMIT_WINDOW_MS);
    if (!isSpam && userData.messages.length > CONFIG.RATE_LIMIT_MAX_MESSAGES) {
        isSpam = true;
        reason = 'Rate Spam (Too many messages too fast)';
    }

    // 4. Duplicate Messages
    userData.duplicates.push({ content: message.content.toLowerCase(), createdTimestamp: message.createdTimestamp });
    userData.duplicates = userData.duplicates.filter(msg => now - msg.createdTimestamp < CONFIG.DUPLICATE_MESSAGE_WINDOW_MS);
    
    if (!isSpam) {
        const exactMatches = userData.duplicates.filter(msg => msg.content === message.content.toLowerCase());
        if (exactMatches.length > CONFIG.MAX_DUPLICATE_MESSAGES) {
            isSpam = true;
            reason = 'Duplicate Messages';
        }
    }

    // ==========================================
    // ACTIONS
    // ==========================================
    if (isSpam) {
        try {
            // Delete the message
            if (message.deletable) {
                await message.delete();
            } else {
                console.log(`[WARNING] Could not delete spam message from ${message.author.tag}. Check bot permissions (Manage Messages).`);
            }

            userData.violations++;
            
            // Log to console
            console.log(`[SPAM DETECTED] User: ${message.author.tag} (${message.author.id}) | Reason: ${reason} | Violations: ${userData.violations}`);

            // Log to channel if configured
            if (CONFIG.LOG_CHANNEL_ID) {
                const logChannel = message.guild.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
                if (logChannel) {
                    await logChannel.send(`⚠️ **Spam Detected**\n**User:** ${message.author.tag} (<@${message.author.id}>)\n**Reason:** ${reason}\n**Violations:** ${userData.violations}/${CONFIG.VIOLATIONS_BEFORE_TIMEOUT}`);
                }
            }

            // Apply timeout if violations threshold reached
            if (userData.violations >= CONFIG.VIOLATIONS_BEFORE_TIMEOUT) {
                if (message.member && message.member.moderatable) {
                    
                    // Delete all their messages in the last 100 messages before timeout, no matter how old
                    try {
                        const fetched = await message.channel.messages.fetch({ limit: 100 });
                        const userMessages = Array.from(fetched.filter(m => m.author.id === message.author.id).values());
                        
                        if (userMessages.length > 0) {
                            const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
                            const recentMessageIds = userMessages.filter(m => m.createdTimestamp > twoWeeksAgo).map(m => m.id);
                            const oldMessages = userMessages.filter(m => m.createdTimestamp <= twoWeeksAgo);

                            if (recentMessageIds.length > 0) {
                                await message.channel.bulkDelete(recentMessageIds, true);
                            }

                            for (const msg of oldMessages) {
                                await msg.delete().catch(() => {});
                            }
                            console.log(`[SPAM CLEANUP] Deleted ${userMessages.length} messages from ${message.author.tag} prior to timeout.`);
                        }
                    } catch (err) {
                        console.error('Failed to cleanup spam messages:', err);
                    }

                    await message.member.timeout(CONFIG.TIMEOUT_DURATION_MS, 'Exceeded spam violation threshold');
                    
                    // Reset violations after timeout
                    userData.violations = 0;
                    
                    console.log(`[TIMEOUT APPLIED] User: ${message.author.tag} (${message.author.id}) has been timed out.`);
                    if (CONFIG.LOG_CHANNEL_ID) {
                        const logChannel = message.guild.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
                        if (logChannel) {
                            await logChannel.send(`🔨 **Timeout Applied**\n**User:** ${message.author.tag} (<@${message.author.id}>) has been timed out for exceeding spam limits.`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to take action on spam:', error);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
