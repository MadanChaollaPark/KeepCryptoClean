# syntax=docker/dockerfile:1.7

FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS build

ENV NODE_ENV=development \
    PUPPETEER_SKIP_DOWNLOAD=true
WORKDIR /app

RUN corepack enable \
    && corepack prepare yarn@1.22.22 --activate

COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
    yarn install --frozen-lockfile --non-interactive

COPY . .
RUN yarn lint \
    && yarn test:unit \
    && yarn build \
    && yarn verify:artifact

FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS runtime

ENV NODE_ENV=production \
    EXPRESS_PORT=3000 \
    LOG_LEVEL=info
WORKDIR /app/runtime

RUN mkdir -p /app/dist /app/scripts /app/runtime \
    && chown -R node:node /app

COPY --from=build --chown=node:node /app/dist/main.js /app/dist/main.js
COPY --from=build --chown=node:node /app/scripts/healthcheck.js /app/scripts/healthcheck.js

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "/app/scripts/healthcheck.js"]

CMD ["node", "/app/dist/main.js"]
