FROM mongo:8.0 AS mongo-tools

FROM node:20.20.1-bookworm-slim

ENV NODE_ENV=production \
    PORT=5000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY --from=mongo-tools /usr/bin/mongodump /usr/local/bin/mongodump
COPY --from=mongo-tools /usr/bin/mongorestore /usr/local/bin/mongorestore

RUN apt-get update \
  && apt-get install -y --no-install-recommends age \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npx playwright install --with-deps chromium \
  && chmod -R a+rX /ms-playwright \
  && npm cache clean --force

COPY --chown=node:node server.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts

USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
