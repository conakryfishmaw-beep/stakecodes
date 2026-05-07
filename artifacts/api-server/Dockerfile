FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY dist/ ./dist/

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
