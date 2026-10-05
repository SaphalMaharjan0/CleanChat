require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionsBitField, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');

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

    // Advanced Features
    BANNED_WORDS: ['badword1', 'badword2'],
    WHITELISTED_DOMAINS: ['youtube.com', 'tenor.com', 'discord.com', 'tenor.co'],
    MAX_ATTACHMENTS: 4,             // Max attachments per message
    CAPS_THRESHOLD_PERCENT: 70,     // Percentage of caps allowed before flagging
    RAID_TIMEOUT_WINDOW_MS: 5 * 60 * 1000, // 5 minutes
    RAID_TIMEOUT_THRESHOLD: 5,      // 5 timeouts in 5 mins triggers lockdown
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
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

// Setup DisTube
let ffmpegPath = '';
try {
    ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
} catch (err) {
    console.log('No @ffmpeg-installer/ffmpeg found, defaulting to system ffmpeg.');
}

client.distube = new DisTube(client, {
    emitNewSongOnly: true,
    emitAddSongWhenCreatingQueue: false,
    emitAddListWhenCreatingQueue: false,
    plugins: [new YtDlpPlugin()],
    ...(ffmpegPath ? { ffmpeg: { path: ffmpegPath } } : {})
});

client.distube
    .on('playSong', (queue, song) => queue.textChannel.send(`🎶 Now playing: \`${song.name}\` - \`${song.formattedDuration}\``))
    .on('addSong', (queue, song) => queue.textChannel.send(`✅ Added \`${song.name}\` to the queue.`))
    .on('addList', (queue, playlist) => queue.textChannel.send(`📋 Added \`${playlist.name}\` playlist (${playlist.songs.length} songs) to queue.`))
    .on('error', (channel, e) => {
        if (channel) channel.send(`❌ An error encountered: ${e.toString().slice(0, 1974)}`);
        else console.error(e);
    });

// Memory storage for user activity
const userActivity = new Map();
const recentTimeouts = [];
let isRaidMode = false;

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


client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    console.log(`🛡️  CleanChat spam protection is active.`);
    
    const commands = [
        new SlashCommandBuilder()
            .setName('play')
            .setDescription('Play a song or playlist from YouTube')
            .addStringOption(option => 
                option.setName('url')
                    .setDescription('The YouTube URL to play')
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('skip')
            .setDescription('Skip the current song'),
        new SlashCommandBuilder()
            .setName('stop')
            .setDescription('Stop the music and clear the queue'),
        new SlashCommandBuilder()
            .setName('queue')
            .setDescription('View the current music queue'),
        new SlashCommandBuilder()
            .setName('delete_message')
            .setDescription('Delete a specific number of recent messages from a user')
            .addUserOption(option => 
                option.setName('user')
                    .setDescription('The user to delete messages from')
                    .setRequired(true))
            .addIntegerOption(option => 
                option.setName('amount')
                    .setDescription('Number of messages to delete (max 100)'))
            .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'play') {
        let url = interaction.options.getString('url');
        const member = interaction.guild.members.cache.get(interaction.user.id);
        if (!member.voice.channel) {
            await interaction.reply({ content: 'You must be in a voice channel to play music!', ephemeral: true });
            return;
        }

        if (url.includes('list=RD')) {
            try {
                const urlObj = new URL(url);
                urlObj.searchParams.delete('list');
                urlObj.searchParams.delete('start_radio');
                urlObj.searchParams.delete('index');
                url = urlObj.toString();
                await interaction.reply('⚠️ *YouTube Mix playlists are not supported by Discord bots. Playing the single video instead!* \n🔍 Searching and adding to queue...');
            } catch(e) {
                await interaction.reply('🔍 Searching and adding to queue...');
            }
        } else {
            await interaction.reply('🔍 Searching and adding to queue...');
        }

        try {
            await client.distube.play(member.voice.channel, url, {
                member: member,
                textChannel: interaction.channel,
            });
        } catch (e) {
            interaction.channel.send(`❌ Failed to play: ${e.message}`);
        }
    }

    if (interaction.commandName === 'skip') {
        const queue = client.distube.getQueue(interaction.guildId);
        if (!queue) return interaction.reply({ content: 'There is nothing playing right now!', ephemeral: true });
        try {
            await queue.skip();
            await interaction.reply('⏭️ Skipped!');
        } catch (e) {
            await interaction.reply(`Error: ${e}`);
        }
    }

    if (interaction.commandName === 'stop') {
        const queue = client.distube.getQueue(interaction.guildId);
        if (!queue) return interaction.reply({ content: 'There is nothing playing right now!', ephemeral: true });
        queue.stop();
        await interaction.reply('⏹️ Stopped the music!');
    }

    if (interaction.commandName === 'queue') {
        const queue = client.distube.getQueue(interaction.guildId);
        if (!queue) return interaction.reply({ content: 'There is nothing playing right now!', ephemeral: true });
        const q = queue.songs
            .map((song, i) => `${i === 0 ? 'Playing:' : `${i}.`} ${song.name} - \`${song.formattedDuration}\``)
            .join('\n');
        await interaction.reply(`**Server Queue**\n${q}`.substring(0, 2000));
    }

    if (interaction.commandName === 'delete_message') {
        const targetUser = interaction.options.getUser('user');
        let amount = interaction.options.getInteger('amount') || 50;
        if (amount > 100) amount = 100;

        await interaction.deferReply({ ephemeral: true });

        try {
            const fetched = await interaction.channel.messages.fetch({ limit: 100 });
            const userMessages = Array.from(fetched.filter(m => m.author.id === targetUser.id).values()).slice(0, amount);
            
            if (userMessages.length > 0) {
                const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
                const recentMessageIds = userMessages.filter(m => m.createdTimestamp > twoWeeksAgo).map(m => m.id);
                const oldMessages = userMessages.filter(m => m.createdTimestamp <= twoWeeksAgo);

                if (recentMessageIds.length > 0) {
                    await interaction.channel.bulkDelete(recentMessageIds, true);
                }

                for (const msg of oldMessages) {
                    await msg.delete().catch(() => {});
                }

                await interaction.editReply(`Successfully deleted ${userMessages.length} messages from ${targetUser.tag}.`);
                
                if (CONFIG.COMMANDS_CHANNEL_ID) {
                    const cmdChannel = interaction.guild.channels.cache.get(CONFIG.COMMANDS_CHANNEL_ID);
                    if (cmdChannel) {
                        await cmdChannel.send(`🗑️ **Command Executed**\n**Admin:** ${interaction.user.tag}\n**Action:** Deleted ${userMessages.length} messages from ${targetUser.tag} in <#${interaction.channel.id}>`);
                    }
                }
            } else {
                await interaction.editReply(`No recent messages found from ${targetUser.tag}.`);
            }
        } catch (error) {
            console.error('Error during purge:', error);
            await interaction.editReply('There was an error trying to purge messages.');
        }
    }
});

client.on('messageCreate', async (message) => {
    // Ignore bots and webhooks
    if (message.author.bot || message.webhookId) return;
    // Ignore DMs
    if (!message.guild) return;

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
        if (links) {
            const nonWhitelistedLinks = links.filter(link => {
                return !CONFIG.WHITELISTED_DOMAINS.some(domain => link.toLowerCase().includes(domain));
            });
            if (nonWhitelistedLinks.length > CONFIG.MAX_LINKS) {
                isSpam = true;
                reason = 'Excessive Links';
            }
        }
    }

    // 2.5 Attachment Spam
    if (!isSpam && message.attachments.size > CONFIG.MAX_ATTACHMENTS) {
        isSpam = true;
        reason = 'Excessive Attachments';
    }

    // 2.6 Banned Words & Phishing
    if (!isSpam) {
        const lowerContent = message.content.toLowerCase();
        
        // Phishing keywords
        const scamKeywords = ['free nitro', 'steam $50', 'discord.gift/', 'discord.com/billing'];
        if (scamKeywords.some(keyword => lowerContent.includes(keyword))) {
            isSpam = true;
            reason = 'Phishing/Scam Link';
            userData.violations += 99; // Instant timeout
        } 
        // Banned words
        else if (CONFIG.BANNED_WORDS.some(word => lowerContent.includes(word.toLowerCase()))) {
            isSpam = true;
            reason = 'Banned Word';
        }
    }

    // 2.7 Caps Spam
    if (!isSpam && message.content.length > 10) {
        const capsCount = (message.content.match(/[A-Z]/g) || []).length;
        const alphaCount = (message.content.match(/[a-zA-Z]/g) || []).length;
        if (alphaCount > 0 && (capsCount / alphaCount) * 100 > CONFIG.CAPS_THRESHOLD_PERCENT) {
            isSpam = true;
            reason = 'Excessive Caps';
        }
    }

    // 2.8 Zalgo Text
    if (!isSpam) {
        const zalgoRegex = /[\u0300-\u036F\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]{3,}/g;
        if (zalgoRegex.test(message.content)) {
            isSpam = true;
            reason = 'Zalgo Text';
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

                    // Raid Mode Tracker
                    recentTimeouts.push(Date.now());
                    const validTimeouts = recentTimeouts.filter(t => Date.now() - t < CONFIG.RAID_TIMEOUT_WINDOW_MS);
                    recentTimeouts.length = 0;
                    recentTimeouts.push(...validTimeouts);

                    if (recentTimeouts.length >= CONFIG.RAID_TIMEOUT_THRESHOLD && !isRaidMode) {
                        isRaidMode = true;
                        try {
                            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
                                SendMessages: false
                            });
                            console.log('[RAID MODE] Server channel locked down due to multiple timeouts.');
                            
                            if (CONFIG.LOG_CHANNEL_ID) {
                                const logChannel = message.guild.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
                                if (logChannel) {
                                    await logChannel.send(`🚨 **RAID DETECTED** 🚨\nMultiple users timed out rapidly. <#${message.channel.id}> has been locked down for 15 minutes.`);
                                }
                            }

                            // Unlock after 15 mins
                            setTimeout(async () => {
                                await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
                                    SendMessages: null
                                });
                                isRaidMode = false;
                                console.log('[RAID MODE] Lockdown lifted.');
                            }, 15 * 60 * 1000);
                        } catch (err) {
                            console.error('Failed to apply lockdown:', err);
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
