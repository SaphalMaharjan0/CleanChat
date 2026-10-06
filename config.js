export const CONFIG = {
    // Spam Thresholds
    RATE_LIMIT_WINDOW_MS: 5000,         // Time window for rate limit (5 seconds)
    RATE_LIMIT_MAX_MESSAGES: 5,         // Max messages allowed in the time window
    DUPLICATE_MESSAGE_WINDOW_MS: 10000, // Time window to check for duplicates
    MAX_DUPLICATE_MESSAGES: 3,          // Max exact duplicate messages allowed
    MAX_MENTIONS: 4,                    // Max user/role mentions per message
    MAX_LINKS: 3,                       // Max HTTP links per message

    // Moderation Settings
    VIOLATIONS_BEFORE_TIMEOUT: 3,           // Spam violations before issuing a timeout
    TIMEOUT_DURATION_MS: 60 * 60 * 1000,    // Timeout duration (1 hour)
    LOG_CHANNEL_ID: '',                     // Channel ID for spam logs (empty = disabled)
    COMMANDS_CHANNEL_ID: '',                // Channel ID for command logs
    EXEMPT_ROLES: [],                       // Role IDs exempt from spam checks

    // Advanced Features
    BANNED_WORDS: ['badword1', 'badword2'],
    SCAM_KEYWORDS: ['free nitro', 'steam $50', 'discord.gift/', 'discord.com/billing'],
    WHITELISTED_DOMAINS: ['youtube.com', 'tenor.com', 'discord.com', 'tenor.co'],
    MAX_ATTACHMENTS: 4,                     // Max attachments per message
    CAPS_THRESHOLD_PERCENT: 70,             // Percentage of caps allowed before flagging
    RAID_TIMEOUT_WINDOW_MS: 5 * 60 * 1000,  // 5 minutes
    RAID_TIMEOUT_THRESHOLD: 5,              // Timeouts within the window that trigger lockdown
    RAID_LOCKDOWN_MS: 15 * 60 * 1000,       // How long a lockdown lasts
};
