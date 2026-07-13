# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

FROM node:26.5.0-bookworm-slim@sha256:e999d087492c7227c85adc70574cf9d3cce774c3e6d7b8dfe473ee6b142c8f2c AS build

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
    && yarn build --public-target-user-id "$KCC_TARGET_USER_ID" --release-commit "$KCC_RELEASE_COMMIT" \
    && KCC_TARGET_USER_ID="$KCC_TARGET_USER_ID" yarn verify:artifact \
    && yarn verify:licenses

FROM node:26.5.0-bookworm-slim@sha256:e999d087492c7227c85adc70574cf9d3cce774c3e6d7b8dfe473ee6b142c8f2c AS runtime

ARG KCC_RELEASE_COMMIT
ENV NODE_ENV=production \
    LOG_LEVEL=info
WORKDIR /app/runtime

LABEL org.opencontainers.image.title="KeepCryptoClean" \
    org.opencontainers.image.description="Read-only Koii public-interest observation task" \
    org.opencontainers.image.licenses="MIT" \
    org.opencontainers.image.source="https://github.com/MadanChaollaPark/KeepCryptoClean" \
    org.opencontainers.image.revision="${KCC_RELEASE_COMMIT}"

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
