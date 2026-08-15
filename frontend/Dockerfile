FROM node:20.20.1-alpine AS build

WORKDIR /app
ARG VITE_API_URL
ARG VITE_3DSMAX_PLUGIN_DOWNLOAD_URL
ARG VITE_MARKETPLACE_IMAGE_SEARCH_ENABLED=false
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_3DSMAX_PLUGIN_DOWNLOAD_URL=${VITE_3DSMAX_PLUGIN_DOWNLOAD_URL}
ENV VITE_MARKETPLACE_IMAGE_SEARCH_ENABLED=${VITE_MARKETPLACE_IMAGE_SEARCH_ENABLED}

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
