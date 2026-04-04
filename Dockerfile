# ---------- build frontend ----------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    xz-utils \
    libgmp10 \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/nuxmv \
    && curl -fL "https://nuxmv.fbk.eu/theme/download.php?file=nuXmv-2.1.0-linux64.tar.xz" -o /tmp/nuxmv.tar.xz \
    && tar -xJf /tmp/nuxmv.tar.xz -C /opt/nuxmv --strip-components=1 \
    && rm /tmp/nuxmv.tar.xz \
    && chmod +x /opt/nuxmv/bin/nuXmv

ENV NUXMV_PATH=/opt/nuxmv/bin/nuXmv
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY server ./server
COPY --from=builder /app/dist ./dist

CMD ["node", "server/index.js"]