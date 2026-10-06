FROM node:22-alpine AS build
WORKDIR /app
# mongodb-memory-server (tests only) would otherwise download a mongod binary.
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json /app/server.js /app/next.config.js ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/lib ./lib
COPY --from=build --chown=node:node /app/models ./models
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js", "--production"]
