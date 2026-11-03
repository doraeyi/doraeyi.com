# syntax=docker/dockerfile:1

FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable

# 先裝套件，只有 lockfile 變了才會重跑這層
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
# 環境變數都是選填（src/env.ts），build 時不用給假值；真正的值在執行時由 docker-compose 的 env_file 帶入
RUN pnpm build

# ---- 只裝執行時需要的套件（mysql2、three）----
FROM node:24-slim AS prod-deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# ---- runtime ----
# 跟 build 用同一個 base image：跨 stage 複製 node_modules 要平台一致，不要換成 alpine
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3100
ENV HOST=0.0.0.0
EXPOSE 3100

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./package.json

USER node
CMD ["node", "build/index.js"]
