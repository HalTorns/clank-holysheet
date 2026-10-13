FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN corepack pnpm install --prod --frozen-lockfile
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
