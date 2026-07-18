# All toolchain commands run inside Docker (node:22). Nothing is installed on the host.
# Host requirements: Docker, make, git, VSCode.

DOCKER = docker run --rm -v "$(CURDIR)":/app -w /app node:22

.PHONY: install build test package check clean

install:
	$(DOCKER) npm install

build:
	$(DOCKER) npx tsc -p ./

test:
	$(DOCKER) npx tsc -p ./tsconfig.test.json
	$(DOCKER) node --test 'test/*.test.js'

package:
	$(DOCKER) npx --yes @vscode/vsce package --no-dependencies

# Full gate: run before every commit.
check: build test package

clean:
	rm -rf out out-test node_modules *.vsix
