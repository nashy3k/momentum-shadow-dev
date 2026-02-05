# ⏱️ System Uptime vs. Process Uptime

This guide explains how to monitor the Momentum Bot on the Zo Computer platform.

## 1. The Distinction
*   **Machine Uptime (`uptime` command)**: Measures how long the *Device* (or Container) has been powered on.
*   **Process Uptime**: Measures how long the *Momentum Bot* code has been running since the last restart.

## 2. The Zo System Supervisor
On the Zo platform, your bot is managed by a **System Supervisor**. This is an invisible service that:
1.  **Auto-Starts**: Launches the bot immediately when the machine boots.
2.  **Auto-Heals**: Restarts the bot within seconds if it crashes or is killed.

Because of this, **PM2 is redundant** on Zo—the platform itself provides the "seatbelts."

## 3. How to Verify Stability (The Source of Truth)
To confirm the bot is active and running the latest Phase 9 "Evolution" code:

1.  **Check the Real-Time Log**:
    ```bash
    tail -f /dev/shm/momentum-bot.log
    ```
    *If you see the "Ready! Logged in as..." message with a recent timestamp, the bot is alive.*

2.  **Check Process Age**: 
    ```bash
    ps -ef | grep "bot.ts"
    ```
    *Look at the `STIME` column. If it shows a recent time, the supervisor just restarted it. If it matches the machine's boot time, it's been stable since launch.*

## 4. Production Readiness
This "Self-Healing" setup ensures that even if you close your terminal or the machine reboots, Momentum continues to monitor your repositories 24/7. 🏥✅
