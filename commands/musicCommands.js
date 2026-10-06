import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { RepeatMode } from 'distube';
import { customRepeat, stayVoiceChannels } from '../state.js';
import { EPHEMERAL } from '../utils.js';

const NO_QUEUE = '❌ There is no active music queue right now!';
const NOTHING_PLAYING = '❌ There is nothing playing right now!';

const getQueue = interaction => interaction.client.distube.getQueue(interaction.guildId);

// Run `fn(queue)` if a queue exists, otherwise reply with `message`
async function withQueue(interaction, message, fn) {
    const queue = getQueue(interaction);
    if (!queue) return interaction.reply({ content: message, flags: EPHEMERAL });
    return fn(queue);
}

// Clean a YouTube URL. Returns { url, mix } where mix is:
//   'single'   - a video inside a Mix: the Mix params were removed, only the video plays
//   'playlist' - a Mix playlist page with no single video: passed through so the whole Mix loads
//   null       - not a Mix
function cleanUrl(raw) {
    const isMix = raw.includes('list=RD');
    if (!isMix && !raw.includes('t=')) return { url: raw, mix: null };
    try {
        const u = new URL(raw);
        const hasVideo = u.searchParams.has('v') || u.hostname === 'youtu.be';
        if (isMix && hasVideo) ['list', 'start_radio', 'index'].forEach(p => u.searchParams.delete(p));
        u.searchParams.delete('t');
        return { url: u.toString(), mix: isMix ? (hasVideo ? 'single' : 'playlist') : null };
    } catch {
        return { url: raw, mix: null };
    }
}

// Shared by /skip and /next
async function skipSong(interaction) {
    customRepeat.delete(interaction.guildId);
    return withQueue(interaction, NOTHING_PLAYING, async queue => {
        const current = queue.songs[0];
        if (queue.songs.length <= 1) {
            return interaction.reply({ content: '⚠️ There is no next song in the queue. Use `/stop` to stop the music.', flags: EPHEMERAL });
        }
        try {
            await queue.skip();
            const next = queue.songs[0];
            await interaction.reply(`⏭️ Skipped **${current.name}**${next ? ` — up next: **${next.name}**` : ''}`);
        } catch (e) {
            await interaction.reply({ content: `❌ Failed to skip: ${e.message}`, flags: EPHEMERAL });
        }
    });
}

function repeatLabel(queue, tracker) {
    if (tracker) return `Repeating current song (${tracker.remaining} time(s) left)`;
    if (queue.repeatMode === RepeatMode.SONG) return '🔂 Repeating current song indefinitely';
    if (queue.repeatMode === RepeatMode.QUEUE) return '🔁 Repeating entire queue indefinitely';
    return 'Disabled';
}

async function showQueue(interaction) {
    const queue = getQueue(interaction);
    if (!queue?.songs.length) {
        return interaction.reply({ content: '❌ There is no active music playlist or queue right now!', flags: EPHEMERAL });
    }

    const page = interaction.options.getInteger('page') || 1;
    const [current, ...upcoming] = queue.songs;
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(upcoming.length / pageSize));

    if (page > totalPages) {
        return interaction.reply({ content: `⚠️ Invalid page number. The playlist only has **${totalPages}** page(s).`, flags: EPHEMERAL });
    }

    const start = (page - 1) * pageSize;
    const upcomingText = upcoming.slice(start, start + pageSize)
        .map((song, i) => `\`${start + i + 1}.\` [${song.name}](${song.url}) - \`${song.formattedDuration}\``)
        .join('\n') || '*No upcoming songs in the queue.*';

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📋 Server Music Playlist / Queue')
        .setDescription(`**Now Playing:**\n🎶 [${current.name}](${current.url})\n⏱️ \`${queue.formattedCurrentTime} / ${current.formattedDuration}\``)
        .addFields(
            { name: `📑 Up Next (Page ${page} of ${totalPages})`, value: upcomingText.substring(0, 1024) },
            {
                name: '📊 Playlist Info',
                value: `• **Total Songs:** ${queue.songs.length}\n• **Total Duration:** \`${queue.formattedDuration}\`\n• **Repeat Mode:** ${repeatLabel(queue, customRepeat.get(interaction.guildId))}\n• **Volume:** \`${queue.volume}%\``,
            },
        )
        .setFooter({ text: 'Use /playlist [page] or /queue [page] to browse • /shuffle to randomize' });

    if (current.thumbnail) embed.setThumbnail(current.thumbnail);
    await interaction.reply({ embeds: [embed] });
}

const pageOption = option => option
    .setName('page')
    .setDescription('Page number to view (1, 2, 3...)')
    .setMinValue(1);

export const play = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist from YouTube or Spotify')
        .addStringOption(o => o.setName('url').setDescription('A YouTube or Spotify link').setRequired(true))
        .addIntegerOption(o => o.setName('repeat').setDescription('Number of times to repeat this song (e.g. 3)'))
        .addBooleanOption(o => o.setName('loop').setDescription('Loop this song indefinitely (true/false)')),

    async execute(interaction) {
        const member = interaction.member;
        const voiceChannel = member?.voice?.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ You must be in a voice channel to play music!', flags: EPHEMERAL }).catch(() => {});
        }

        const input = interaction.options.getString('url').trim();
        if (!/^https?:\/\/\S+$/i.test(input)) {
            return interaction.reply({
                content: '❌ That is not a link. Paste the full link, for example a YouTube video or playlist, or a Spotify track, album or playlist.',
                flags: EPHEMERAL,
            });
        }

        stayVoiceChannels.set(interaction.guildId, voiceChannel.id);
        await interaction.deferReply().catch(() => {});

        const { url, mix } = cleanUrl(input);
        const warning = {
            single: '⚠️ *That link is a video inside a YouTube Mix, so only the single video will play.* \n',
            playlist: 'ℹ️ *Loading a YouTube Mix — this can take a moment.* \n',
        }[mix] ?? '';
        await interaction.editReply(`${warning}🔍 Searching and adding to queue...`).catch(() => {});

        const repeatTimes = interaction.options.getInteger('repeat');
        const loop = interaction.options.getBoolean('loop');

        try {
            await interaction.client.distube.play(voiceChannel, url, { member, textChannel: interaction.channel });

            if (loop || repeatTimes > 0) {
                setTimeout(() => {
                    const queue = getQueue(interaction);
                    if (!queue) return;
                    queue.setRepeatMode(RepeatMode.SONG);
                    if (loop) customRepeat.delete(interaction.guildId);
                    else customRepeat.set(interaction.guildId, { remaining: repeatTimes, total: repeatTimes });
                }, 1000);
            }
        } catch (e) {
            interaction.followUp({ content: `❌ Failed to play: ${e.message}`, flags: EPHEMERAL }).catch(() => {});
        }
    },
};

export const repeat = {
    data: new SlashCommandBuilder()
        .setName('repeat')
        .setDescription('Repeat the current song or queue (indefinitely or a specific number of times)')
        .addStringOption(o => o.setName('mode').setDescription('Repeat mode').setRequired(true).addChoices(
            { name: 'Repeat Song (Current Song)', value: 'song' },
            { name: 'Repeat Queue (All Songs)', value: 'queue' },
            { name: 'Off (Disable Repeat)', value: 'off' },
        ))
        .addIntegerOption(o => o.setName('times')
            .setDescription('Number of times to repeat (optional, leave empty for indefinite repeat)')
            .setMinValue(1).setMaxValue(100)),

    execute: interaction => withQueue(interaction, NO_QUEUE, queue => {
        const mode = interaction.options.getString('mode');
        const times = interaction.options.getInteger('times');
        const { guildId } = interaction;

        if (mode === 'off') {
            queue.setRepeatMode(RepeatMode.DISABLED);
            customRepeat.delete(guildId);
            return interaction.reply('⏹️ Repeat mode disabled.');
        }
        if (mode === 'queue') {
            customRepeat.delete(guildId);
            queue.setRepeatMode(RepeatMode.QUEUE);
            return interaction.reply('🔁 Now repeating the **entire queue** indefinitely.');
        }

        const songName = queue.songs[0]?.name ?? 'Current song';
        queue.setRepeatMode(RepeatMode.SONG);
        if (times > 0) {
            customRepeat.set(guildId, { remaining: times, total: times });
            return interaction.reply(`🔁 Repeating **${songName}** for **${times}** time(s).`);
        }
        customRepeat.delete(guildId);
        return interaction.reply(`🔁 Repeating **${songName}** **indefinitely** (loop forever).`);
    }),
};

export const shuffle = {
    data: new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Shuffle the songs in the current playlist/queue'),

    execute: interaction => withQueue(interaction, NO_QUEUE, async queue => {
        if (queue.songs.length <= 1) {
            return interaction.reply({ content: '⚠️ Need at least 2 songs in the queue to shuffle.', flags: EPHEMERAL });
        }
        try {
            await queue.shuffle();
            await interaction.reply(`🔀 Successfully shuffled **${queue.songs.length - 1}** upcoming songs in the queue!`);
        } catch (e) {
            await interaction.reply({ content: `❌ Failed to shuffle queue: ${e.message}`, flags: EPHEMERAL });
        }
    }),
};

export const skip = {
    data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current song'),
    execute: skipSong,
};

export const next = {
    data: new SlashCommandBuilder().setName('next').setDescription('Skip the current song and play the next one'),
    execute: skipSong,
};

export const stop = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop the music and clear the queue (stays in VC)'),

    execute: interaction => {
        customRepeat.delete(interaction.guildId);
        return withQueue(interaction, NOTHING_PLAYING, async queue => {
            queue.stop();
            await interaction.reply('⏹️ Stopped the music! (Staying connected to voice channel)');
        });
    },
};

export const playlist = {
    data: new SlashCommandBuilder()
        .setName('playlist')
        .setDescription('View the current music playlist with pagination and details')
        .addIntegerOption(pageOption),
    execute: showQueue,
};

export const queue = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('View the current music queue/playlist')
        .addIntegerOption(pageOption),
    execute: showQueue,
};
