FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

COPY package*.json ./

RUN apt-get update \
	&& apt-get install -y --no-install-recommends build-essential \
	&& rm -rf /var/lib/apt/lists/*

RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8080
ENV PLAYWRIGHT_HEADLESS=true

EXPOSE 8080

CMD ["node", "server.js"]
