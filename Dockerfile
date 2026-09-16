# --- Etape 1 : build du front et du serveur ---
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci

COPY . .
RUN npm run build

# --- Etape 2 : image d'execution ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci --omit=dev --workspace @ow/server --include-workspace-root

COPY --from=build /app/packages/server/dist ./dist
# Front compile servi par le serveur : une seule origine, un seul conteneur.
COPY --from=build /app/packages/web/dist ./public

EXPOSE 3000
CMD ["node", "dist/index.js"]
