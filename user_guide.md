# 👥 User Access & Security Guide

This document outlines the current **Authentication (AuthN)** and **Authorization (AuthZ)** architecture of Momentum, along with the roadmap for multi-tenancy.

## 1. Current Architecture: "Single-Pilot, Public View"

For the Hackathon v1.0, Momentum operates as a **Single-Tenant Backend** with a **Open Frontend**.

| Component | Status | Who has access? |
| :--- | :--- | :--- |
| **The Brain (Zo Bot)** | **Private** | Only the Owner (`nashy3k`). The bot runs on a secure container using the Owner's GitHub/Google API keys. |
| **The Dashboard** | **Public (Auth Gate)** | Any user with a Google Account can log in. |
| **The Data** | **Shared** | Currently, **all logged-in users** see the same fleet of repositories (the Owner's repos). |

### 🛑 Judge Access Limitations
If a Judge or User logs in with their own Google Account:
1.  **They CAN**: View the live status of the Owner's repositories ("View Only" mode).
2.  **They CANNOT**: Add their own repositories or trigger the bot.
    *   *Reason*: The Bot on Zo is hardcoded to listen for the Owner's commands and uses the Owner's API keys. It does not yet dynamically load keys for other users.
3.  **They CANNOT**: trigger actions that require specific GitHub permissions (unless they are the repo owner).

### ❓ Why should a Judge link their Discord ID?
If the system is "Locked" to the owner, you might wonder why the `/momentum link` command exists for judges.
- **Technical Demonstration**: It proves the **Cross-Platform Auth Bridge**. By linking, a judge can verify that Momentum successfully maps a Discord User to a Web Dashboard Profile in real-time.
- **Notification Simulation**: It demonstrates how the bot identifies users. In a multi-tenant environment, this link is what allows the bot to @mention the correct developer when a "Shadow PR" is ready.
- **UX Verification**: Linking allows the judge to see their own name and avatar appear on the Momentum Dashboard, proving the NextAuth/Firestore integration is working as designed.

## 2. Future Multi-Tenancy Roadmap (Commercial Phase)
To move from "Hackathon Demo" to "SaaS Product", the following changes are required:

### A. Data Isolation (Row-Level Security)
We will implement **Firestore Security Rules** to ensure users only see their own data.
```javascript
// Future Firestore Rule
match /repositories/{repoId} {
  allow read, write: if resource.data.ownerId == request.auth.uid;
}
```

### B. "Bring Your Own Key" (BYOK) Vault (Feasibility Study)
To allow external users to add their own repos, we will move away from the static `.env` file to a dynamic Vault system.

**Implementation Plan:**
1.  **Dashboard UI**: Add "Settings > Integration" page where users can input their encrypted `GITHUB_TOKEN`.
2.  **Encryption**: Token is encrypted (AES-256) and stored in Firestore under `users/{uid}/vault/github`.
3.  **Bot Logic Update**:
    *   Instead of `process.env.GITHUB_TOKEN`, the bot will read the `userId` from the discord interaction.
    *   Fetch and decrypt the specific user's token.
    *   Initialize a *new* `Octokit` instance for that specific request.
4.  **GitHub Apps (Preferred)**: Alternatively, we can register "Momentum" as a GitHub App. Users simply click "Install on my Repos" (OAuth2), and we get a temporary installation token. This removes the need for users to handle raw API keys.

## 3. Deployment for Judges (Forking & Self-Hosting)
If a Judge wants to verify the code by running it themselves (forking), they have full capability to do so, provided they bring their own infrastructure.

### 🛠️ "The Forker's Checklist"
The judge will need to create a `.env` file in the root directory with the following **Required Credentials**:

| Variable | Requirement | Scopes / Permissions |
| :--- | :--- | :--- |
| `GOOGLE_API_KEY` | Gemini 1.5/3.0 API Key | `GenAI API Access` |
| `DISCORD_TOKEN` | Discord Bot Token | **OAuth2**: `bot`, `applications.commands`<br>**Bot Perms**: `Send Messages`, `Embed Links`, `Read Message History` |
| `GITHUB_TOKEN` | Classic PAT | `repo` (Full control) & `workflow` (optional) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Firebase Service Account | `Firestore Editor` |

### 🔍 Deep Dive: Granular Scopes
To ensure Momentum works as intended, the following scopes are **mandatory**:

#### GitHub Personal Access Token (PAT)
- **`repo`**: Momentum needs to read your code files and create issues/PRs.
- **`read:user`**: Required to identify the author of stagnant commits.
- **`workflow`**: Required if you want the bot to self-repair GitHub Action CI failures.

#### Discord Bot Setup
When inviting the bot to your test server, use the URL generator with these settings:
- **Scopes**: `bot`, `applications.commands`.
- **Bot Permissions**: 
    - `Send Messages`
    - `Embed Links` (Crucial for Dashboard previews)
    - `Read Message History`
    - `Use External Emojis` (For 🟢/🔴 status indicators)

### 🚨 What Happens?
*   **Installation**: `npm install` handles all dependencies perfectly.
*   **Startup**: `npm run start-bot` will perform a "Pre-Flight Check".
    *   If any key is missing, the bot will print a clear error: `[Error] Missing Environment Variable: DISCORD_TOKEN` and exit safely.
*   **Isolation**: Forking the repo **DOES NOT** grant access to the original `nashy3k` database or memory banks. The judge starts with a "Blank Brain" (Tabula Rasa).
