# Showcase studio image: records the docs/showcase GIFs by driving the REAL webview assets
# (media/*.html|css|js) in headless Chromium, then encodes the captured frames with ffmpeg and
# gifsicle. Nothing is installed on the host; the repo's root package.json stays untouched.
FROM mcr.microsoft.com/playwright:v1.55.1-noble

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg gifsicle fonts-inter fonts-jetbrains-mono \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /studio-deps
COPY package.json package-lock.json ./
RUN npm ci
ENV NODE_PATH=/studio-deps/node_modules

WORKDIR /app/docs/showcase/studio
