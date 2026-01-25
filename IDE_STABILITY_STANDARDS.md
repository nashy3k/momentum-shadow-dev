# Global IDE Stability Standards (Windows)

To maintain a snappy, memory-efficient development environment when working with complex agentic projects, follow these "Antigravity Golden Rules". 

## 1. The IDE Stability Rule (Memory Management)
**Objective**: Prevent the Language Server (LSP) from crashing or eating 10GB+ of RAM.

*   **Exclusion Matrix**: Always create a `.vscode/settings.json` file in every new project root with the following exclusions:
    ```json
    {
      "search.exclude": { "**/node_modules": true, "**/.next": true, "**/dist": true, "**/media": true },
      "files.watcherExclude": { "**/node_modules/**": true, "**/.next/**": true, "**/media/**": true }
    }
    ```
*   **Metadata Externalization**: Never store large datasets (JSON/CSV) inside `.ts` or `.tsx` files as variables. Move them to external `.js` or `.json` files and load them at runtime to keep the editor's live-reloading logic lightweight.

## 2. The Project Isolation Rule (Workspace Cleanliness)
**Objective**: Prevent dependency "Cross-Pollination" and global tool pollution.

*   **No Global Installers**: Never run `.exe` installers or install global npm tools (`-g`) inside a project's workspace.
*   **Playground Protocol**: When testing a new library or framework (e.g., trying out a new UI kit), always create a dedicated `playground/` directory outside your primary project.
*   **Local Tooling**: Prefer `npx <tool>` over installing tools to your path.

## 3. The Robust Integration Rule (Security & Persistence)
**Objective**: Ensure API keys and environment variables persist across reloads.

*   **Explicit Config**: Favor manual `.env` loading using `dotenv` over "magic" auto-loading plugins.
*   **Manual Injection**: When using Cloud SDKs (GCP, Firebase), explicitly pass service account paths or token headers in your code rather than relying on system-wide login state.

## 4. The Windows-First Protocol
**Objective**: Avoid "gh.exe not found" or "Linux path formatting" errors.

*   **API-Over-CLI**: Always favor Web APIs (`fetch`) over calling local `.exe` binaries (like `gh`, `git`, `ffmpeg`). This ensures your code is portable to the Cloud (Linux) without modification.
*   **POSIX Paths**: Use the `path` module for all direct file system interactions to handle the `\` vs `/` mismatch automatically.
