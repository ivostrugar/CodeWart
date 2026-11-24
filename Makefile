# CodeWart — streamlined commands. Run `make` to list them.

SHELL := /bin/bash

# Node may not be on PATH when it is managed by nvm/fnm (loaded only in
# interactive shells). Find it: PATH first, then nvm, Volta, fnm, Homebrew.
NODE_DIR ?= $(shell \
	if command -v npm >/dev/null 2>&1; then dirname "$$(command -v npm)"; \
	elif [ -d "$(HOME)/.nvm/versions/node" ]; then \
		d="$$(cat "$(HOME)/.nvm/alias/default" 2>/dev/null)"; d="$${d\#v}"; \
		m="$$(ls -d "$(HOME)/.nvm/versions/node/v$$d"*/bin 2>/dev/null | sort -V | tail -1)"; \
		[ -n "$$m" ] && echo "$$m" || ls -d "$(HOME)"/.nvm/versions/node/*/bin | sort -V | tail -1; \
	elif [ -x "$(HOME)/.volta/bin/npm" ]; then echo "$(HOME)/.volta/bin"; \
	elif [ -d "$(HOME)/.local/state/fnm_multishells" ] || [ -d "$(HOME)/.fnm" ]; then \
		ls -d "$(HOME)"/.fnm/node-versions/*/installation/bin "$(HOME)"/Library/Application\ Support/fnm/node-versions/*/installation/bin 2>/dev/null | sort -V | tail -1; \
	elif [ -x /opt/homebrew/bin/npm ]; then echo /opt/homebrew/bin; \
	fi)
export PATH := $(if $(NODE_DIR),$(NODE_DIR):,)$(HOME)/.cargo/bin:$(PATH)

# Resolve tools explicitly (make 3.81 on macOS ignores the exported PATH for direct execs).
CARGO_BIN := $(shell command -v cargo 2>/dev/null || echo $(HOME)/.cargo/bin/cargo)
RUSTUP   := $(shell command -v rustup 2>/dev/null || echo $(HOME)/.cargo/bin/rustup)
NPM      ?= $(if $(NODE_DIR),$(NODE_DIR)/npm,scripts/npm-docker)
TAURI    := $(if $(NODE_DIR),$(NPM) exec -- tauri,$(CARGO_BIN) tauri)
CARGO    := cd src-tauri && $(CARGO_BIN)
UNAME_S  := $(shell uname -s)
BIN_DIR  ?= $(HOME)/.local/bin
APP_DIR  ?= /Applications
BUNDLE   := src-tauri/target/release/bundle
P        ?=

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[36m<target>\033[0m\n"} /^[a-zA-Z0-9_-]+:.*?##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)
	@echo

##@ Setup

.PHONY: setup
setup: doctor deps ## Check toolchains and install all dependencies

.PHONY: deps
deps: ## Install npm dependencies and fetch crates
	$(NPM) install
	$(CARGO) fetch
ifeq ($(NODE_DIR),)
	@$(CARGO_BIN) tauri --version >/dev/null 2>&1 || $(CARGO_BIN) install tauri-cli --version 2.12.4 --locked
endif

.PHONY: doctor
doctor: ## Verify required toolchains are installed
	@command -v cargo >/dev/null || { echo "✗ Rust missing: curl https://sh.rustup.rs -sSf | sh"; exit 1; }
	@$(if $(NODE_DIR),command -v node,docker info) >/dev/null 2>&1 || { echo "✗ Node.js >= 20 or running Docker required"; exit 1; }
	@command -v git   >/dev/null || { echo "✗ git missing"; exit 1; }
	@echo "✓ cargo $$(cargo --version | cut -d' ' -f2)  ✓ $(if $(NODE_DIR),node $$(node --version),npm via Docker)  ✓ git $$(git --version | cut -d' ' -f3)"

##@ Develop

.PHONY: dev
dev: ## Run the app with hot reload (P=path/to/repo to open a project)
	CODEWART_CWD="$(if $(P),$(abspath $(P)),$(CURDIR))" $(TAURI) dev $(if $(P),-- -- "$(abspath $(P))",)

.PHONY: web
web: ## Run only the Vite dev server (UI without the Rust backend)
	$(NPM) run dev

.PHONY: run
run: ## Launch the installed app on P (default: current dir)
	"$(BIN_DIR)/codewart" $(if $(P),"$(P)",)

##@ Quality

.PHONY: check
check: typecheck ## Type-check frontend and backend
	$(CARGO) check

.PHONY: typecheck
typecheck: ## Type-check the TypeScript UI
	$(NPM) run typecheck

.PHONY: lint
lint: typecheck ## Clippy (warnings are errors) + TypeScript
	$(CARGO) clippy --all-targets -- -D warnings

.PHONY: fmt
fmt: ## Format Rust sources
	$(CARGO) fmt

.PHONY: fmt-check
fmt-check: ## Check Rust formatting
	$(CARGO) fmt -- --check

.PHONY: test
test: ## Run Rust unit tests and the TypeScript type-check
	$(CARGO) test
	$(NPM) run typecheck

.PHONY: ci
ci: fmt-check lint test build-web ## Everything CI should run

##@ Build

.PHONY: build-web
build-web: ## Build the UI bundle into dist/
	$(NPM) run build

.PHONY: build
build: ## Build release app + installers for this platform
	$(TAURI) build

.PHONY: build-debug
build-debug: ## Build an unoptimised app bundle (faster)
	$(TAURI) build --debug

.PHONY: build-app
build-app: deps ## Build just the app bundle (.app / AppImage / msi), no DMG
ifeq ($(UNAME_S),Darwin)
	$(TAURI) build --bundles app
else ifeq ($(UNAME_S),Linux)
	$(TAURI) build --bundles appimage
else
	$(TAURI) build --bundles msi
endif

.PHONY: build-universal
build-universal: ## macOS universal binary (Apple Silicon + Intel)
	$(RUSTUP) target add aarch64-apple-darwin x86_64-apple-darwin
	$(TAURI) build --target universal-apple-darwin

.PHONY: dist
dist: ## Build installers for this OS and collect them in ./release
ifeq ($(UNAME_S),Darwin)
	$(RUSTUP) target add aarch64-apple-darwin x86_64-apple-darwin
	$(TAURI) build --target universal-apple-darwin --bundles app
	rm -rf release
	mkdir -p release/dmg-root
	cp -R src-tauri/target/universal-apple-darwin/release/bundle/macos/CodeWart.app release/dmg-root/
	ln -s /Applications release/dmg-root/Applications
	# Plain hdiutil DMG: no Finder scripting, so it works headless and in CI.
	hdiutil create -quiet -volname CodeWart -srcfolder release/dmg-root -fs HFS+ -format UDZO -ov "release/CodeWart_$$(node -p "require('./package.json').version")_universal.dmg"
	rm -rf release/dmg-root
	cd src-tauri/target/universal-apple-darwin/release/bundle/macos && zip -qry $(CURDIR)/release/CodeWart_macos_universal.app.zip CodeWart.app
else
	$(TAURI) build
	rm -rf release
	mkdir -p release
	-cp $(BUNDLE)/deb/*.deb $(BUNDLE)/appimage/*.AppImage $(BUNDLE)/rpm/*.rpm release/ 2>/dev/null
	-cp $(BUNDLE)/msi/*.msi $(BUNDLE)/nsis/*.exe release/ 2>/dev/null
endif
	@echo "✓ installers in ./release:" && ls -1 release

.PHONY: release
release: ## Tag the package.json version and push it; CI builds all platforms
	@v=$$(node -p "require('./package.json').version"); \
	git tag -a "v$$v" -m "CodeWart v$$v" && git push origin "v$$v" && \
	echo "✓ pushed v$$v: the Release workflow builds macOS, Linux and Windows installers"

.PHONY: icons
icons: ## Regenerate app icons from assets/brand/app-icon/codewart-icon-1024.png
	$(TAURI) icon assets/brand/app-icon/codewart-icon-1024.png -o src-tauri/icons
	rm -rf src-tauri/icons/android src-tauri/icons/ios

##@ Install

.PHONY: install
install: build-app install-app install-cli install-skill ## Build and install the app, `wart` CLI and Claude skill

.PHONY: install-app
install-app: ## Install the built app (macOS: $(APP_DIR), Linux: $(BIN_DIR))
ifeq ($(UNAME_S),Darwin)
	rm -rf "$(APP_DIR)/CodeWart.app" "$(APP_DIR)/Codewart.app"
	cp -R "$(BUNDLE)/macos/CodeWart.app" "$(APP_DIR)/"
	@echo "✓ installed $(APP_DIR)/CodeWart.app"
else
	mkdir -p "$(BIN_DIR)"
	install -m 755 src-tauri/target/release/codewart "$(BIN_DIR)/codewart-app"
	@echo "✓ installed $(BIN_DIR)/codewart-app"
endif

.PHONY: install-cli
install-cli: ## Install the `wart` launcher (and `codewart` alias) into $(BIN_DIR)
	mkdir -p "$(BIN_DIR)"
	install -m 755 scripts/wart "$(BIN_DIR)/wart"
	install -m 755 scripts/wart "$(BIN_DIR)/codewart"
	@echo "✓ installed $(BIN_DIR)/wart (and codewart)"
	@case ":$$PATH:" in *":$(BIN_DIR):"*) ;; *) echo "  note: add $(BIN_DIR) to your PATH";; esac

SKILL_DIR ?= $(HOME)/.claude/skills

.PHONY: install-skill
install-skill: ## Install the codewart-review Claude Code skill into $(SKILL_DIR)
	mkdir -p "$(SKILL_DIR)/codewart-review"
	install -m 644 skills/codewart-review/SKILL.md "$(SKILL_DIR)/codewart-review/SKILL.md"
	@echo "✓ installed Claude skill $(SKILL_DIR)/codewart-review"

.PHONY: uninstall
uninstall: ## Remove the app and CLI
	rm -f "$(BIN_DIR)/wart" "$(BIN_DIR)/codewart" "$(BIN_DIR)/codewart-app"
	rm -rf "$(SKILL_DIR)/codewart-review"
ifeq ($(UNAME_S),Darwin)
	rm -rf "$(APP_DIR)/CodeWart.app" "$(APP_DIR)/Codewart.app"
endif

##@ Housekeeping

.PHONY: clean
clean: ## Remove build output
	rm -rf dist
	$(CARGO) clean

.PHONY: distclean
distclean: clean ## Remove build output and node_modules
	rm -rf node_modules
