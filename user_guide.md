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

### B. "Bring Your Own Key" (BYOK) Vault
Instead of using the Owner's `.env` file, the bot will fetch API keys from a secure Vault based on the user triggering the command.
*   **User A -> /momentum check -> Bot loads User A's GH_TOKEN**
*   **User B -> /momentum check -> Bot loads User B's GH_TOKEN**

## 3. Deployment for Judges (Forking)
If a Judge forks this repository to test it themselves:
*   They **MUST** provide their own `.env` credentials (OpenAI/Gemini, Discord, GitHub).
*   They **MUST** set up their own Firestore instance.
*   **Security Guarantee**: The code is designed to crash safely if these credentials are missing, ensuring no "leakage" of the original owner's access.
