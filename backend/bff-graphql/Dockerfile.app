FROM node:20-alpine AS builder
WORKDIR /build
ARG VITE_GRAPHQL_URL=/graphql
ENV VITE_GRAPHQL_URL=$VITE_GRAPHQL_URL
RUN apk add --no-cache openssl
COPY package*.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/bff-graphql/package.json ./backend/bff-graphql/package.json
RUN npm ci
COPY frontend/ ./frontend/
COPY backend/bff-graphql/ ./backend/bff-graphql/
RUN npm run db:generate --workspace=backend/bff-graphql && npm run build:app

FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    FRONTEND_DIST_PATH=/app/frontend-dist \
    DATABASE_URL=file:/app/data/jidis.db
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/bff-graphql/package.json ./backend/bff-graphql/package.json
RUN npm ci --omit=dev --workspace=backend/bff-graphql --include-workspace-root=false && npm cache clean --force
COPY backend/bff-graphql/prisma ./backend/bff-graphql/prisma
COPY --from=builder /build/backend/bff-graphql/dist ./backend/bff-graphql/dist
COPY --from=builder /build/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /build/frontend/dist /app/frontend-dist
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health >/dev/null || exit 1
CMD ["sh", "-c", "npx prisma db push --skip-generate --schema backend/bff-graphql/prisma/schema.prisma && node backend/bff-graphql/dist/index.js"]
