# All toolchain commands run in Node 22 containers. Nothing is installed on the host.
# Host requirements: Docker or Apple Container, make, git, VSCode.

# The named npm-cache volume persists downloads across the ephemeral containers, so heavy
# fetches (e.g. @vscode/vsce for `package`) happen ONCE instead of on every run.
CONTAINER_ENGINE ?= $(shell command -v docker >/dev/null 2>&1 && echo docker || { command -v container >/dev/null 2>&1 && echo container; })
ifeq ($(strip $(CONTAINER_ENGINE)),)
$(error Install Docker or Apple Container to run the toolchain)
endif
DOCKER = $(CONTAINER_ENGINE) run --rm -v "$(CURDIR)":/app -v loopboard-npm-cache:/root/.npm -w /app docker.io/library/node:22

# The feature-showcase GIFs (docs/showcase/) need Chromium, ffmpeg and gifsicle, which node:22 does
# not have — so they get their OWN image with their OWN package.json (docs/showcase/studio/). The
# recording container runs with no network, the repo as its only mount and no extra capabilities.
SHOWCASE_IMAGE = loopboard-showcase

.PHONY: install build test package check clean showcase readme

install:
	$(DOCKER) npm install

# Sentinel target: (re)install only when the manifest or lockfile is newer than node_modules,
# so a fresh checkout (or post-`clean`) auto-installs once and up-to-date trees skip it.
node_modules: package.json package-lock.json
	$(DOCKER) npm install
	@touch node_modules

build: | node_modules
	$(DOCKER) npx --no-install tsc -p ./

test: | node_modules
	$(DOCKER) npx --no-install tsc -p ./tsconfig.test.json
	$(DOCKER) node --test 'test/*.test.js'

package: | node_modules
	$(DOCKER) npx --yes @vscode/vsce package --no-dependencies
	$(DOCKER) sh scripts/assert-vsix-contents.sh

# Pre-commit gate: build + test only, no .vsix. Opt in to packaging too with `make check PACKAGE=1`.
check: build test $(if $(PACKAGE),package)

# Re-record docs/showcase/gifs/*.gif from the REAL media/ webviews; the mini host drives them with
# out-test/'s pure modules. `make showcase SCENES="01 07"` records only the scenes named.
showcase: | node_modules
	$(DOCKER) npx --no-install tsc -p ./tsconfig.test.json
	$(CONTAINER_ENGINE) build -q -t $(SHOWCASE_IMAGE) docs/showcase/studio
	$(CONTAINER_ENGINE) run --rm --network none --shm-size=1g -v "$(CURDIR)":/app $(SHOWCASE_IMAGE) node record.js $(SCENES)
	$(MAKE) readme

# Rebuild docs/guide.md's machine-owned regions — the showcase from docs/showcase/README.md, the settings
# tables from package.json — then check coverage (the readme-regen skill's tool).
readme:
	$(DOCKER) node .claude/skills/readme-regen/readme-tool.js generate
	$(DOCKER) node .claude/skills/readme-regen/readme-tool.js check

clean:
	rm -rf out out-test node_modules *.vsix docs/showcase/studio/.frames
