# Relay + web on one origin: build web/ (it imports relay/src), then run the relay serving web/dist.
FROM node:26 AS web
WORKDIR /app
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci
COPY relay/src relay/src
COPY web web
ARG VITE_NEAR_NETWORK=mainnet
ARG VITE_SHOP_URL
RUN cd web && npm run build

FROM node:26-slim
WORKDIR /app/relay
COPY relay/package.json ./
COPY relay/src src
COPY --from=web /app/web/dist /app/web/dist
ENV WEB_DIST=/app/web/dist
CMD ["node", "src/main.ts"]
