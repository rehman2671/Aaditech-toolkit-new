# Multi-stage / Production Dockerfile for IT-Toolkit Enterprise Node.js Backend
FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies first for cached layer build
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy application source code
COPY . .

# Ensure directory permissions for runtime data and artifacts
RUN mkdir -p /data /artifacts /certs && \
    chown -R node:node /app /data /artifacts /certs

USER node

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
