FROM node:24-alpine

RUN apk add --no-cache ca-certificates
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY bin/ ./bin/
COPY lib/ ./lib/
COPY public/ ./public/
COPY index.html ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY sources.js scores.js benchmark-data.js README.md LICENSE ./

ENV NODE_ENV=production
ENV HOME=/config
EXPOSE 7352

ENTRYPOINT ["node", "bin/modelrelay.js"]
CMD ["--port", "7352", "--no-log"]
