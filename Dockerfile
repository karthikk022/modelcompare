# Stage 1: Build React client
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Server
FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .
COPY --from=client-build /app/client/dist ./client/dist

ENV PORT=3001
EXPOSE 3001

VOLUME /app/data

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/health || exit 1

CMD ["node", "server.js"]
