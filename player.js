import { DisTube, RepeatMode } from 'distube';
import { SpotifyPlugin } from '@distube/spotify';
import { FixedYtDlpPlugin } from './ytdlp-plugin.js';
import { customRepeat } from './state.js';

let ffmpegPath = '';
try {
    ({ default: { path: ffmpegPath } } = await import('@ffmpeg-installer/ffmpeg'));
} catch {
    console.log('No @ffmpeg-installer/ffmpeg found, defaulting to system ffmpeg.');
}

// Optional: Spotify API credentials (not required; without them, links are read from the public page)
const spotifyOptions = process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET
    ? { api: { clientId: process.env.SPOTIFY_CLIENT_ID, clientSecret: process.env.SPOTIFY_CLIENT_SECRET } }
    : {};

const say = (queue, text) => queue.textChannel?.send(text).catch(() => {});

function repeatSuffix(queue) {
    const info = customRepeat.get(queue.id);
    if (info) {
        if (info.remaining === 0) return ` 🔁 *(Final repeat)*`;
        return ` 🔁 *(Repeat remaining: ${info.remaining})*`;
    }
    if (queue.repeatMode === RepeatMode.SONG) return ' 🔂 *(Looping indefinitely)*';
    if (queue.repeatMode === RepeatMode.QUEUE) return ' 🔁 *(Queue looping)*';
    return '';
}

export function createDistube(client) {
    const distube = new DisTube(client, {
        emitNewSongOnly: true,
        emitAddSongWhenCreatingQueue: false,
        emitAddListWhenCreatingQueue: true,
        plugins: [
            // Spotify links are read for song info, then matched to a YouTube result
            new SpotifyPlugin(spotifyOptions),
            new FixedYtDlpPlugin({ update: false }),
        ],
        ...(ffmpegPath ? { ffmpeg: { path: ffmpegPath } } : {}),
    });

    distube
        .on('playSong', (queue, song) => {
            console.log(`[🎵 PLAYING] ${song.name} - ${song.formattedDuration} | By: ${song.user.tag}`);
            say(queue, `🎶 Now playing: \`${song.name}\` - \`${song.formattedDuration}\`${repeatSuffix(queue)}`);
        })
        .on('finishSong', (queue, song) => {
            const tracker = customRepeat.get(queue.id);
            if (tracker && tracker.remaining !== undefined) {
                if (tracker.remaining > 0) {
                    tracker.remaining--;
                } else {
                    queue.setRepeatMode(RepeatMode.DISABLED);
                    customRepeat.delete(queue.id);
                    say(queue, `🔁 Finished repeating \`${song.name}\` (${tracker.total} times). Repeat mode disabled.`);
                }
            }
        })
        .on('addSong', (queue, song) => {
            console.log(`[✅ QUEUED] ${song.name} - ${song.formattedDuration} | By: ${song.user.tag}`);
            say(queue, `✅ Added \`${song.name}\` to the queue.`);
        })
        .on('addList', (queue, playlist) => {
            console.log(`[📋 PLAYLIST QUEUED] ${playlist.name} (${playlist.songs.length} songs) | By: ${playlist.user.tag}`);
            say(queue, `📋 Added \`${playlist.name}\` playlist (${playlist.songs.length} songs) to queue.`);
        })
        .on('error', (error, queue) => {
            console.error('[❌ DISTUBE ERROR]', error);
            if (queue) {
                if (queue.repeatMode === RepeatMode.SONG) {
                    queue.setRepeatMode(RepeatMode.DISABLED);
                    customRepeat.delete(queue.id);
                }
                say(queue, `❌ An error encountered: ${(error?.message || String(error)).slice(0, 1900)}`);
            }
        })
        .on('disconnect', queue => {
            console.log(`[🔌 DISCONNECTED] Left voice channel in ${queue.voice.channel?.guild?.name}`);
        })
        .on('finish', () => console.log('[🏁 FINISHED] The queue has ended.'))
        .on('empty', () => console.log('[🕳️ EMPTY VC] Voice channel is empty.'));

    return distube;
}
