FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json tsconfig.json ./

COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @workspace/api-server run build

FROM node:24-alpine

WORKDIR /app

COPY --from=builder /app/artifacts/api-server/dist/ ./dist/
COPY --from=builder /app/artifacts/api-server/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
