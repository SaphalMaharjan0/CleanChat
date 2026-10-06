import { CONFIG } from './config.js';

export const userActivity = new Map();      // userId -> spam tracking data
export const stayVoiceChannels = new Map(); // guildId -> channelId (24/7 VC persistence)
export const customRepeat = new Map();      // guildId -> { remaining, total }
export const recentTimeouts = [];           // timestamps of recent timeouts (raid detection)
export const raid = { active: false };

export function getUserData(userId) {
    let data = userActivity.get(userId);
    if (!data) {
        data = { messages: [], duplicates: [], violations: 0 };
        userActivity.set(userId, data);
    }
    return data;
}

// Periodically drop stale spam-tracking data to prevent memory leaks
export function startCleanupTimer() {
    const interval = Math.max(CONFIG.RATE_LIMIT_WINDOW_MS, CONFIG.DUPLICATE_MESSAGE_WINDOW_MS);
    setInterval(() => {
        const now = Date.now();
        for (const [userId, data] of userActivity) {
            data.messages = data.messages.filter(t => now - t < CONFIG.RATE_LIMIT_WINDOW_MS);
            data.duplicates = data.duplicates.filter(m => now - m.createdTimestamp < CONFIG.DUPLICATE_MESSAGE_WINDOW_MS);
            if (!data.messages.length && !data.duplicates.length && !data.violations) {
                userActivity.delete(userId);
            }
        }
    }, interval).unref();
}
