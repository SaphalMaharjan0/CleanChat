import { join, leave } from './voice.js';
import { play, repeat, shuffle, skip, next, stop, playlist, queue } from './musicCommands.js';
import { deleteMessage } from './moderation.js';

// To add a command: create { data, execute } and add it to this list.
const all = [join, leave, play, repeat, shuffle, skip, next, stop, playlist, queue, deleteMessage];

export const commands = new Map(all.map(cmd => [cmd.data.name, cmd]));
export const commandsJSON = all.map(cmd => cmd.data.toJSON());
