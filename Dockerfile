# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS build

ENV NODE_ENV=development
ARG KCC_TARGET_USER_ID
ARG KCC_RELEASE_COMMIT
WORKDIR /app

RUN corepack enable \
    && corepack prepare yarn@1.22.22 --activate

COPY package.json yarn.lock ./
COPY scripts/patch-task-manager.js ./scripts/patch-task-manager.js
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
    yarn install --frozen-lockfile --non-interactive

COPY . .
RUN KCC_TARGET_USER_ID="$KCC_TARGET_USER_ID" yarn lint \
    && yarn test:unit \
    && KCC_RELEASE_COMMIT="$KCC_RELEASE_COMMIT" KCC_TARGET_USER_ID="$KCC_TARGET_USER_ID" yarn build \
    && KCC_TARGET_USER_ID="$KCC_TARGET_USER_ID" yarn verify:artifact \
    && yarn verify:licenses

FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS runtime

ENV NODE_ENV=production \
    LOG_LEVEL=info
WORKDIR /app/runtime

RUN mkdir -p /app/dist /app/scripts /app/runtime /app/LICENSES \
    && chown -R node:node /app

COPY --from=build --chown=node:node /app/dist/main.js /app/dist/main.js
COPY --from=build --chown=node:node /app/dist/THIRD_PARTY_BUNDLE_NOTICES.txt /app/dist/THIRD_PARTY_BUNDLE_NOTICES.txt
COPY --from=build --chown=node:node /app/scripts/healthcheck.js /app/scripts/healthcheck.js
COPY --from=build --chown=node:node /app/LICENSE /app/LICENSE
COPY --from=build --chown=node:node /app/THIRD_PARTY_NOTICES.md /app/THIRD_PARTY_NOTICES.md
COPY --from=build --chown=node:node /app/LICENSES/ /app/LICENSES/

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "/app/scripts/healthcheck.js"]

CMD ["node", "/app/dist/main.js"]
