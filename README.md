# CleanChat Discord Bot

A Discord bot built with Node.js and discord.js v14 that automatically detects and deletes spam messages, including rate spam, duplicate messages, mass mentions, and excessive/invite links. It also automatically times out users who repeatedly spam.

## Features
- **24/7 Voice Channel Persistence:** Bot joins voice channel and stays forever (even when empty or songs finish) until disconnected by an Admin.
- **Auto-Reconnect:** If disconnected unexpectedly or due to server connection issues, automatically rejoins the target voice channel.
- **Rate Spam Detection:** Limits how many messages a user can send within a specific time window.
- **Duplicate Messages:** Deletes messages if a user sends the exact same content multiple times.
- **Mass Mentions:** Prevents users from mentioning too many users/roles in a single message.
- **Link & Invite Filtering:** Deletes messages with too many HTTP links, and immediately deletes any Discord invite links.
- **Automatic Timeouts:** Automatically times out users after a configurable number of spam violations.
- **Exemptions:** Users with the "Manage Messages" permission or specific roles are exempt from spam checks.

## Slash Commands
- `/join` - Make the bot join your current voice channel and stay 24/7.
- `/leave` - Disconnect the bot from voice channel (*Admin only*).
- `/play <url> [repeat] [loop]` - Play music with optional repeat count or infinite loop.
- `/repeat <mode> [times]` - Set repeat mode (`song`, `queue`, `off`) indefinitely or for a custom number of times.
- `/shuffle` - Randomly shuffle the order of songs in the current playlist/queue.
- `/skip` - Skip current song.
- `/stop` - Stop playback and clear the queue without leaving the VC.
- `/playlist [page]` - View the current music playlist and song details with pagination.
- `/queue [page]` - View active music queue/playlist.
- `/delete_message <user> [amount]` - Bulk delete messages from a specific user.

## Setup Instructions

### 1. Create a Discord Application
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** and give it a name (e.g., CleanChat).
3. Go to the **Bot** tab and click **Reset Token** to get your bot's token. **Keep this secret!**
4. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (Required to read message contents for spam checks).
   - **Server Members Intent** (Optional, but recommended for member checking).

### 2. Invite the Bot to Your Server
1. Go to the **OAuth2 > URL Generator** tab.
2. Select the `bot` scope.
3. Under **Bot Permissions**, select the following permissions:
   - Read Messages/View Channels
   - Send Messages
   - Manage Messages (Required to delete spam)
   - Moderate Members (Required to timeout users)
4. Copy the generated URL and paste it into your browser to invite the bot to your server.

### 3. Project Configuration
1. Clone this repository or download the source code.
2. Run `npm install` to install dependencies.
3. Copy the `.env.example` file and rename it to `.env`:
   ```bash
   cp .env.example .env
   ```
4. Open the `.env` file and paste your bot token:
   ```env
   DISCORD_TOKEN=your_actual_bot_token
   ```

### 4. Bot Configuration
Open `index.js` and modify the `CONFIG` object at the top of the file to adjust the spam thresholds, timeout durations, and set a log channel or exempt roles.

### 5. Run the Bot
Run the following command to start the bot:
```bash
node index.js
```
