FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

RUN apt-get update \
	&& apt-get install -y --no-install-recommends build-essential \
	&& rm -rf /var/lib/apt/lists/*

RUN PRISMA_SKIP_POSTINSTALL_GENERATE=1 npm ci \
	&& DATABASE_URL="postgresql://generate:generate@localhost:5432/generate" npx prisma generate \
	&& npm prune --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8080
ENV PLAYWRIGHT_HEADLESS=true

EXPOSE 8080

CMD ["node", "server.js"]
