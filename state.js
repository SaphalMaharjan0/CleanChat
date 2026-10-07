import { CONFIG } from './config.js';
import fs from 'fs';
import path from 'path';

export const userActivity = new Map();      // userId -> spam tracking data
export const stayVoiceChannels = new Map(); // guildId -> channelId (24/7 VC persistence)
export const customRepeat = new Map();      // guildId -> { remaining, total }
export const recentTimeouts = [];           // timestamps of recent timeouts (raid detection)
export const raid = { active: false };

const dataDir = path.join(process.cwd(), 'data');
const vcDataFile = path.join(dataDir, 'voice-channels.json');

export function loadStayChannels() {
    try {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        if (fs.existsSync(vcDataFile)) {
            const data = JSON.parse(fs.readFileSync(vcDataFile, 'utf8'));
            for (const [k, v] of Object.entries(data)) {
                stayVoiceChannels.set(k, v);
            }
        }
    } catch (e) {
        console.error('Failed to load voice-channels.json, starting empty:', e);
    }
}

function saveStayChannels() {
    try {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(vcDataFile, JSON.stringify(Object.fromEntries(stayVoiceChannels)), 'utf8');
    } catch (e) {
        console.error('Failed to save stayVoiceChannels:', e);
    }
}

export function setStayChannel(guildId, channelId) {
    stayVoiceChannels.set(guildId, channelId);
    saveStayChannels();
}

export function clearStayChannel(guildId) {
    stayVoiceChannels.delete(guildId);
    saveStayChannels();
}

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
