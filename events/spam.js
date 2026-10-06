import { PermissionsBitField } from 'discord.js';
import { CONFIG } from '../config.js';
import { getUserData, raid, recentTimeouts } from '../state.js';
import { purgeUserMessages, sendLog } from '../utils.js';

const LINK_REGEX = /https?:\/\/[^\s]+/g;
const INVITE_REGEX = /(discord\.gg\/|discord\.com\/invite\/)[^\s]+/i;
const ZALGO_REGEX = /[\u0300-\u036F\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]{3,}/;

// ==========================================
// SPAM CHECKS
// Each check returns a reason string if the message is spam, otherwise nothing.
// Checks run in order and the first match wins.
// ==========================================
const checks = [
    message => {
        const mentions = message.mentions.users.size + message.mentions.roles.size;
        if (mentions > CONFIG.MAX_MENTIONS) return 'Mass Mentions';
    },

    message => {
        if (INVITE_REGEX.test(message.content)) return 'Discord Invite Link';
        const links = message.content.match(LINK_REGEX) ?? [];
        const bad = links.filter(link => !CONFIG.WHITELISTED_DOMAINS.some(d => link.toLowerCase().includes(d)));
        if (bad.length > CONFIG.MAX_LINKS) return 'Excessive Links';
    },

    message => {
        if (message.attachments.size > CONFIG.MAX_ATTACHMENTS) return 'Excessive Attachments';
    },

    (message, userData) => {
        const text = message.content.toLowerCase();
        if (CONFIG.SCAM_KEYWORDS.some(k => text.includes(k))) {
            userData.violations += 99; // Instant timeout
            return 'Phishing/Scam Link';
        }
        if (CONFIG.BANNED_WORDS.some(w => text.includes(w.toLowerCase()))) return 'Banned Word';
    },

    message => {
        if (message.content.length <= 10) return;
        const caps = (message.content.match(/[A-Z]/g) ?? []).length;
        const letters = (message.content.match(/[a-zA-Z]/g) ?? []).length;
        if (letters > 0 && (caps / letters) * 100 > CONFIG.CAPS_THRESHOLD_PERCENT) return 'Excessive Caps';
    },

    message => {
        if (ZALGO_REGEX.test(message.content)) return 'Zalgo Text';
    },

    // Rate and duplicate checks need history, so they are evaluated in detectSpam()
];

function detectSpam(message, userData) {
    const now = Date.now();

    let reason;
    for (const check of checks) {
        reason = check(message, userData);
        if (reason) break;
    }

    // Rate spam (history is always recorded, even if already flagged)
    userData.messages.push(now);
    userData.messages = userData.messages.filter(t => now - t < CONFIG.RATE_LIMIT_WINDOW_MS);
    if (!reason && userData.messages.length > CONFIG.RATE_LIMIT_MAX_MESSAGES) {
        reason = 'Rate Spam (Too many messages too fast)';
    }

    // Duplicate messages
    const content = message.content.toLowerCase();
    userData.duplicates.push({ content, createdTimestamp: message.createdTimestamp });
    userData.duplicates = userData.duplicates.filter(m => now - m.createdTimestamp < CONFIG.DUPLICATE_MESSAGE_WINDOW_MS);
    if (!reason && userData.duplicates.filter(m => m.content === content).length > CONFIG.MAX_DUPLICATE_MESSAGES) {
        reason = 'Duplicate Messages';
    }

    return reason;
}

function isExempt(message) {
    if (!message.member) return false;
    if (message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return true;
    return CONFIG.EXEMPT_ROLES.some(id => message.member.roles.cache.has(id));
}

// ==========================================
// ACTIONS
// ==========================================
async function triggerRaidLockdown(message) {
    recentTimeouts.push(Date.now());
    const valid = recentTimeouts.filter(t => Date.now() - t < CONFIG.RAID_TIMEOUT_WINDOW_MS);
    recentTimeouts.length = 0;
    recentTimeouts.push(...valid);

    if (recentTimeouts.length < CONFIG.RAID_TIMEOUT_THRESHOLD || raid.active) return;

    raid.active = true;
    const { channel, guild } = message;
    try {
        await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
        console.log('[RAID MODE] Server channel locked down due to multiple timeouts.');
        await sendLog(guild, CONFIG.LOG_CHANNEL_ID, `🚨 **RAID DETECTED** 🚨\nMultiple users timed out rapidly. <#${channel.id}> has been locked down for ${CONFIG.RAID_LOCKDOWN_MS / 60000} minutes.`);

        setTimeout(async () => {
            await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }).catch(console.error);
            raid.active = false;
            console.log('[RAID MODE] Lockdown lifted.');
        }, CONFIG.RAID_LOCKDOWN_MS);
    } catch (err) {
        raid.active = false;
        console.error('Failed to apply lockdown:', err);
    }
}

async function punish(message, userData, reason) {
    const { author, guild, channel } = message;

    if (message.deletable) await message.delete();
    else console.log(`[WARNING] Could not delete spam message from ${author.tag}. Check bot permissions (Manage Messages).`);

    userData.violations++;
    console.log(`[SPAM DETECTED] User: ${author.tag} (${author.id}) | Reason: ${reason} | Violations: ${userData.violations}`);
    await sendLog(guild, CONFIG.LOG_CHANNEL_ID, `⚠️ **Spam Detected**\n**User:** ${author.tag} (<@${author.id}>)\n**Reason:** ${reason}\n**Violations:** ${userData.violations}/${CONFIG.VIOLATIONS_BEFORE_TIMEOUT}`);

    if (userData.violations < CONFIG.VIOLATIONS_BEFORE_TIMEOUT) return;
    if (!message.member?.moderatable) return;

    // Remove their recent messages before the timeout, no matter how old
    try {
        const count = await purgeUserMessages(channel, author.id);
        if (count) console.log(`[SPAM CLEANUP] Deleted ${count} messages from ${author.tag} prior to timeout.`);
    } catch (err) {
        console.error('Failed to cleanup spam messages:', err);
    }

    await message.member.timeout(CONFIG.TIMEOUT_DURATION_MS, 'Exceeded spam violation threshold');
    userData.violations = 0;

    console.log(`[TIMEOUT APPLIED] User: ${author.tag} (${author.id}) has been timed out.`);
    await sendLog(guild, CONFIG.LOG_CHANNEL_ID, `🔨 **Timeout Applied**\n**User:** ${author.tag} (<@${author.id}>) has been timed out for exceeding spam limits.`);

    await triggerRaidLockdown(message);
}

export async function onMessage(message) {
    if (message.author.bot || message.webhookId || !message.guild) return;
    if (isExempt(message)) return;

    const userData = getUserData(message.author.id);
    const reason = detectSpam(message, userData);
    if (!reason) return;

    try {
        await punish(message, userData, reason);
    } catch (error) {
        console.error('Failed to take action on spam:', error);
    }
}
