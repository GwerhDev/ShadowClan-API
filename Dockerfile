# syntax = docker/dockerfile:1

ARG NODE_VERSION=18.15.0
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Node.js"

WORKDIR /app

ENV NODE_ENV="production"


# Build stage: install all deps (including devDependencies) and compile TypeScript
FROM base AS build

RUN apt-get update -qq && \
    apt-get install -y build-essential pkg-config python-is-python3

COPY --link package-lock.json package.json ./
RUN npm ci --include=dev

COPY --link . .
RUN npm run build


# Final stage: production only — no devDependencies, no TypeScript source
FROM base

COPY --link package-lock.json package.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 8080
CMD [ "npm", "run", "start" ]
