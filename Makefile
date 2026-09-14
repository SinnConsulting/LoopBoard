# All toolchain commands run inside Docker. Nothing is installed on the host.
# Host requirements: Docker, make, git, VSCode.
# Two images: node:22 for the toolchain, and a pinned Playwright image for the webview suite only.

# The named npm-cache volume persists downloads across the ephemeral containers, so heavy
# fetches (e.g. @vscode/vsce for `package`) happen ONCE instead of on every run.
DOCKER = docker run --rm -v "$(CURDIR)":/app -v loopboard-npm-cache:/root/.npm -w /app node:22

# The webview suite needs Playwright + its browsers, which node:22 does not have — so it gets its
# OWN image (test-e2e/Dockerfile, pinned tag) with its OWN package.json. The root manifest's
# devDependencies stay exactly typescript + @types/vscode (CLAUDE.md non-negotiable #2).
E2E_IMAGE = loopboard-e2e
# --ipc=host: Chromium is prone to OOM crashes on Docker's default 64MB /dev/shm.
E2E_DOCKER = docker run --rm --ipc=host -v "$(CURDIR)":/app -w /app/test-e2e $(E2E_IMAGE)

.PHONY: install build test e2e e2e-image package check clean

install:
	$(DOCKER) npm install

# Sentinel target: (re)install only when the manifest or lockfile is newer than node_modules,
# so a fresh checkout (or post-`clean`) auto-installs once and up-to-date trees skip it.
node_modules: package.json package-lock.json
	$(DOCKER) npm install
	@touch node_modules

build: | node_modules
	$(DOCKER) npx --no-install tsc -p ./

# `build` is a prerequisite (not just node_modules): test/host.test.js runs the vscode-importing
# modules out of out/ against test/fake-vscode.js, so the extension-host build must be current.
# Make runs `build` once per invocation, so `check` doesn't compile twice.
test: build
	$(DOCKER) npx --no-install tsc -p ./tsconfig.test.json
	$(DOCKER) node --test 'test/*.test.js'

e2e-image:
	docker build -t $(E2E_IMAGE) test-e2e

# Webview suite (media/*.js in a real browser). Depends on `test` for out-test/, which
# test-e2e/fixtures.js builds its board payloads from. `make e2e UPDATE=1` rewrites the committed
# screenshot baselines under test-e2e/__screenshots__/.
# `playwright` (not `npx playwright`): the binary lives in the IMAGE's /e2e/node_modules/.bin, and
# npx — resolving from the mounted /app, which has no node_modules — would silently download a
# DIFFERENT Playwright version than the browsers the image ships.
e2e: test e2e-image
	$(E2E_DOCKER) playwright test $(if $(UPDATE),--update-snapshots)

package: | node_modules
	$(DOCKER) npx --yes @vscode/vsce package --no-dependencies
	$(DOCKER) sh scripts/assert-vsix-contents.sh

# Pre-commit gate: build + test + the webview suite, no .vsix. Opt in to packaging too with
# `make check PACKAGE=1`.
check: build test e2e $(if $(PACKAGE),package)

clean:
	rm -rf out out-test node_modules *.vsix test-e2e/test-results test-e2e/playwright-report
