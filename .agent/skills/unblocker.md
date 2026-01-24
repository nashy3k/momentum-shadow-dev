# Skill: Repo Unblocker

This skill empowers the **Momentum** agent to proactively unblock developers by detecting stagnation and proposing solutions via GitHub Pull Requests.

## Capabilities

1.  **Monitor**: Periodic check of repository activity.
2.  **Research**: Contextual analysis of the "stuck" state using Genkit + Gemini.
3.  **PR**: Automated code generation and PR submission.

## Logic Flow

### 1. Monitor (Stuck Detection)
- **Tool**: `git log -1 --format=%cd`
- **Threshold**: 3 days (259,200 seconds) of inactivity.
- **Action**: If current time - last commit time > threshold, trigger **Research**.

### 2. Research (Strategy Generation)
- **Prompt**: "You are a lead architect. This repository has seen no activity for 3 days. Analyze the current `package.json`, `src/` directory, and any open issues/TODOs. Propose one high-impact improvement or fix to unblock the developer."
- **Output**: A structured plan including:
    - Target file.
    - Description of change.
    - Reasoning.

### 3. PR (Implementation)
- **Branch**: Create `momentum/unblock-[timestamp]`.
- **Commit**: Focused change based on research.
- **PR Title**: `[Shadow PR] Momentum: Automatically unblocking your progress`
- **PR Body**: Explanation of why this was generated and links to Opik traces.

## Tools Required
- `stagnation_checker` (Custom TS function)
- `github_cli` (MCP or direct execution)
- `gemini_flash_2_0` (Via Genkit)
