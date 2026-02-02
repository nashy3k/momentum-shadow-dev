# Use Node.js 20 as the base image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Install system dependencies if needed (e.g., for native modules)
# RUN apt-get update && apt-get install -y ...

# Copy package files (root and sub-packages if using workspaces, but here we assume root)
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the project (if needed for shared libs, otherwise tsx handles it)
# RUN npm run build 
# Note: Since we are using tsx for the bot, explicit build might not be strictly necessary 
# for just running the bot, but good for type checking.
# For now, we rely on tsx for runtime execution to keep it simple as per "start-bot" script.

# Expose port (Zo might expect a web port, but for a Discord bot it's outbound WebSocket)
# However, if Zo health checks via HTTP, we might need a tiny Express server. 
# For now, we assume standard persistent worker.

# Start the bot
CMD ["npm", "run", "start-bot"]
