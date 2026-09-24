# Webview suite image. The Playwright browsers + the font set the screenshot baselines were
# recorded against both come from this pinned tag — nothing is installed on the host, and node:22
# (the toolchain image for everything else) stays free of Playwright.
#
# The tag MUST stay in lockstep with the @playwright/test version in package.json: Playwright
# refuses to drive browsers it did not ship with.
FROM mcr.microsoft.com/playwright:v1.55.1-noble

WORKDIR /e2e

# Installed into the IMAGE, not into the mounted repo: /app is bind-mounted read-write at run time
# and must never grow a node_modules/ of its own.
COPY package.json package-lock.json ./
RUN npm ci

ENV NODE_PATH=/e2e/node_modules
ENV PATH=/e2e/node_modules/.bin:$PATH

# The repo is mounted at /app; the suite reads media/, test/fixtures/ and out-test/ from there.
WORKDIR /app/test-e2e
