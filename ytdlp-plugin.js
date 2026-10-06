import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DisTubeError, ExtractorPlugin, Playlist, Song } from 'distube';
import { download } from '@distube/yt-dlp';

// The stock @distube/yt-dlp plugin mixes yt-dlp's stderr (warnings such as
// "Deprecated Feature: ...") into stdout before JSON.parse, which crashes
// whenever yt-dlp prints a warning. This subclass reads stdout only.

const require = createRequire(import.meta.url);
const pluginDir = path.dirname(require.resolve('@distube/yt-dlp'));
const BIN_DIR = process.env.YTDLP_DIR || path.join(pluginDir, '..', 'bin');
const BIN_NAME = process.env.YTDLP_FILENAME || `yt-dlp${process.platform === 'win32' ? '.exe' : ''}`;
const YTDLP_PATH = path.join(BIN_DIR, BIN_NAME);

function runYtDlp(url, extraArgs = []) {
    const args = [url, '--dump-single-json', '--no-warnings', '--prefer-free-formats', '--skip-download', '--simulate', ...extraArgs];
    return new Promise((resolve, reject) => {
        const proc = spawn(YTDLP_PATH, args);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', chunk => { stdout += chunk; });
        proc.stderr.on('data', chunk => { stderr += chunk; });
        proc.on('error', reject);
        proc.on('close', code => {
            if (code !== 0) return reject(new Error(stderr || `yt-dlp exited with code ${code}`));
            try {
                resolve(JSON.parse(stdout));
            } catch {
                reject(new Error(`Could not parse yt-dlp output. ${stderr}`.trim()));
            }
        });
    });
}

const isPlaylist = info => Array.isArray(info.entries);

// Playlists are listed without loading every video's full details (much faster),
// and capped so a huge playlist can't flood the queue.
const MAX_PLAYLIST_SONGS = 100;

function toSong(plugin, info, options) {
    return new Song({
        plugin,
        source: info.extractor || info.ie_key || 'youtube',
        playFromSource: true,
        id: info.id,
        name: info.title || info.fulltitle,
        url: info.webpage_url || info.original_url || info.url,
        isLive: info.is_live,
        thumbnail: info.thumbnail || info.thumbnails?.[0]?.url,
        duration: info.is_live ? 0 : info.duration,
        uploader: { name: info.uploader, url: info.uploader_url },
        views: info.view_count,
        likes: info.like_count,
        ageRestricted: Boolean(info.age_limit) && info.age_limit >= 18,
    }, options);
}

// Handles any link yt-dlp supports (YouTube etc.) and also searches YouTube by
// text, which is how Spotify songs (info only) are matched to something playable.
export class FixedYtDlpPlugin extends ExtractorPlugin {
    constructor({ update = true } = {}) {
        super();
        if (update) download().catch(() => {}); // keep the yt-dlp binary up to date
    }

    validate() {
        return true;
    }

    async resolve(url, options) {
        const info = await runYtDlp(url, ['--flat-playlist', '--playlist-end', String(MAX_PLAYLIST_SONGS)]).catch(e => {
            throw new DisTubeError('YTDLP_ERROR', e.message);
        });
        if (isPlaylist(info)) {
            const entries = info.entries.filter(Boolean);
            if (entries.length === 0) throw new DisTubeError('YTDLP_ERROR', 'The playlist is empty');
            return new Playlist({
                source: info.extractor,
                songs: entries.map(i => toSong(this, i, options)),
                id: info.id.toString(),
                name: info.title,
                url: info.webpage_url,
                thumbnail: info.thumbnails?.[0]?.url,
            }, options);
        }
        return toSong(this, info, options);
    }

    // Find the best YouTube match for a text query (used for Spotify songs)
    async searchSong(query, options) {
        const info = await runYtDlp(`ytsearch1:${query}`, ['--flat-playlist']).catch(() => null);
        const entry = info?.entries?.find(Boolean);
        return entry ? toSong(this, entry, options) : null;
    }

    async getStreamURL(song) {
        if (!song.url) {
            throw new DisTubeError('YTDLP_PLUGIN_INVALID_SONG', 'Cannot get stream url from invalid song.');
        }
        const info = await runYtDlp(song.url, ['--no-playlist', '--format', 'ba/ba*']).catch(e => {
            throw new DisTubeError('YTDLP_ERROR', e.message);
        });
        if (isPlaylist(info)) throw new DisTubeError('YTDLP_ERROR', 'Cannot get stream URL of a entire playlist');
        return info.url;
    }

    getRelatedSongs() {
        return [];
    }
}
