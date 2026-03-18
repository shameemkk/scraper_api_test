FROM node:20-slim

RUN apt-get update && apt-get install -y \
    wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev && rm -rf /tmp/*

COPY . .

EXPOSE 3099

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3099/api/progress || exit 1

CMD ["node", "server.js"]
