FROM node:20-alpine AS frontend-builder
WORKDIR /build/frontend
ARG VITE_GRAPHQL_URL=/graphql
ENV VITE_GRAPHQL_URL=$VITE_GRAPHQL_URL
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine AS backend-builder
WORKDIR /build/backend
RUN apk add --no-cache openssl
COPY backend/bff-graphql/package*.json ./
RUN npm ci
COPY backend/bff-graphql/ ./
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    FRONTEND_DIST_PATH=/app/frontend-dist \
    DATABASE_URL=file:/app/data/jidis.db
WORKDIR /app/backend
RUN apk add --no-cache openssl
COPY backend/bff-graphql/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY backend/bff-graphql/prisma ./prisma
COPY --from=backend-builder /build/backend/dist ./dist
COPY --from=backend-builder /build/backend/node_modules/.prisma ./node_modules/.prisma
COPY --from=frontend-builder /build/frontend/dist /app/frontend-dist
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health >/dev/null || exit 1
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
