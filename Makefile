# All toolchain commands run inside Docker (node:22). Nothing is installed on the host.
# Host requirements: Docker, make, git, VSCode.

# The named npm-cache volume persists downloads across the ephemeral containers, so heavy
# fetches (e.g. @vscode/vsce for `package`) happen ONCE instead of on every run.
DOCKER = docker run --rm -v "$(CURDIR)":/app -v loopboard-npm-cache:/root/.npm -w /app node:22

.PHONY: install build test package check clean

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

# Full gate: run before every commit.
check: build test package

clean:
	rm -rf out out-test node_modules *.vsix
