# Multi-stage / Production Dockerfile for IT-Toolkit Enterprise Node.js Backend
FROM node:24-alpine AS base

WORKDIR /app

# FE-40: install only the exact reviewed lockfile graph; never fall back
# to a different dependency graph after npm ci fails. The offline LAN
# deliverable still needs pinned image digests and an attested offline bundle.
COPY package.json package-lock.json ./
RUN node -e "if (Number(process.versions.node.split('.')[0]) !== 24) process.exit(1)"
RUN npm ci --omit=dev --no-audit --no-fund

# Copy application source code
COPY . .

# Ensure directory permissions for runtime data and artifacts
RUN mkdir -p /data /artifacts /certs && \
    chown -R node:node /app /data /artifacts /certs

USER 1000:1000

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
