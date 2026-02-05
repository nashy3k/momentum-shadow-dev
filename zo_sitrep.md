# Zo Sitrep: The "Zombie" shadow Developer

If you killed the nodes and they immediately came back with **new PIDs** (e.g., jumping from 156 to 595), you have an **Auto-Restart Watchdog** active on your Zo Computer.

## 🕵️ What's Happening?
The Zo environment (or a script in your project) is programmed to ensure "High Availability." When you kill the bot, the system thinks it crashed and immediately revives it.

**The Clue**: `PID 545: sh -c node server.js`
This often indicates a shell loop (`while true; do node server.js; done`) is running in the background.

## ⚠️ The Conflict
Having a system-level watchdog AND **PM2** at the same time is like having two drivers fighting for the steering wheel. It causes the "Double Bot" issue you're seeing.

## 🚀 The Fix for a Clean Demo
To have a "clean" PM2 list for your video, we need to stop the mystery supervisor.

### 1. Stop the "Hidden" Server
Run this in Zo to stop the shell loop first:
```bash
pkill -f "sh -c node server.js"
pkill -f "node server.js"
```

### 🔍 Monitoring Logs
Since PM2 is bypassed, use the system log found at:
```bash
tail -f /dev/shm/momentum-bot.log
```
*This is your source of truth for all `console.log` output from the bot.*

### 2. Kill the Bot (Again)
```bash
pkill -f tsx
```

### 3. Verify it's DEAD
Run `ps aux | grep node`. You should see **NO** `bot.ts` or `server.js` entries. 
*(If they still come back, check your Zo Dashboard for a "Restart on Failure" toggle or a Startup Script field).*

### 4. Let PM2 take Control
Once the list is empty, start the "Official" process:
```bash
pm2 start "npx tsx src/discord/bot.ts" --name momentum-bot
pm2 save
```

## ✅ Why this is better for Monday:
PM2 gives you a **Status UI** that looks great in a demo video. A hidden shell loop is "invisible" and harder to explain to judges!
