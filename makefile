DEFAULT: help

# print available targets with descriptions
help:
	@echo ""
	@echo "  Available targets:"
	@awk '/^[ \t]*#/ { sub(/^[ \t]*#[ \t]?/, "", $$0); c=$$0; next } /^[a-zA-Z_0-9\-]+:/ { n=split($$0, a, ":"); printf "  \033[1;32m%-20s\033[0m : \033[36m%s\033[0m\n", a[1], c; c="" }' $(MAKEFILE_LIST)
	@echo ""

# run the development vesion of the app
run: 
	cd app && npm start

# run the development version of the hex tool (the subdomain build)
run_hextool:
	cd app && npm run start:hextool

# run uploadthat locally (needs run_uploadthat_api in another terminal)
run_uploadthat:
	cd app && npm run start:uploadthat

# serve the uploadthat PHP API locally on :8787, for run_uploadthat to proxy to
run_uploadthat_api:
	cd ./php/uploadthat; \
	php -S localhost:8787 -t . api/index.php; \
	cd -; \

# Seeds a few releases and deletes everything on Ctrl-C. REGISTRY_DEV_DATA
# keeps the data, NO_SEED starts empty, PORT moves it.
# run the whole registry locally: API, UI, and a throwaway password
registry_dev:
	php/registry/tests/dev.sh

# Nothing can log in without an admin_password_hash, so use registry_dev
# instead unless you specifically want to point at your own data.
# serve the registry bare on :8788, against your own config
run_registry:
	cd ./php/registry; \
	php -S localhost:8788 -t public tests/dev-router.php; \
	cd -; \

# two uploadthat clients against a throwaway API, deleted when you Ctrl-C
uploadthat_duo:
	php/uploadthat/tests/duo.sh

# run the uploadthat API's own tests (needs php on PATH)
test_uploadthat:
	php php/uploadthat/tests/run.php

# check a DEPLOYED uploadthat over real HTTP: make smoke_uploadthat URL=https://...
URL ?= https://uploadthat.nteague.com
smoke_uploadthat:
	php/uploadthat/tests/smoke.sh "$(URL)" "$(OPERATOR_KEY)"

# run the same HTTP checks locally, against php -S, without deploying anything
test_uploadthat_http:
	php/uploadthat/tests/local.sh

# every uploadthat test there is: the store, then the whole API over HTTP
test_uploadthat_all: test_uploadthat test_uploadthat_http

# run the registry API's own tests, in-process (needs php on PATH)
test_registry:
	php php/registry/tests/run.php

# the same checks over HTTP against php -S, without deploying anything
test_registry_http:
	php/registry/tests/local.sh

# The whole command surface against the real API with no server, plus the real
# transport against php -S. Needs php and python3.
# run the nt CLI's tests
test_nt:
	cd ./cli/tests; \
	python3 -m unittest discover -s . -p 'test_*.py'; \
	cd -; \

# every registry test there is: the API, then HTTP, then the CLI
test_registry_all: test_registry test_registry_http test_nt

# Pass the password by environment rather than as an argument, which would show
# up in ps and in your shell history. Without one, only the public checks run:
#   make smoke_registry REGISTRY_URL=https://... REGISTRY_PASSWORD=...
# check a DEPLOYED registry over real HTTP
REGISTRY_URL ?= https://api.nteague.com
smoke_registry:
	php/registry/tests/smoke.sh "$(REGISTRY_URL)" "$(REGISTRY_PASSWORD)"

# The guide ships inside the Python package so `nt manual` works from a plain
# pip install, with no repository checked out. cli/tests/test_manual.py fails
# if the two copies differ.
# copy the integration guide into the nt package
sync_integration_doc:
	cp php/registry/INTEGRATION.md cli/nt/data/INTEGRATION.md
	@echo "Synced cli/nt/data/INTEGRATION.md"

# Needs the wasm32 target and wasm-pack:
#   rustup target add wasm32-unknown-unknown && cargo install wasm-pack
# The build folder is committed, like the others: it is what cPanel pulls.
# build NPaint: compile the Rust to wasm and assemble the static page
build_npaint:
	cd ./npaint; \
	wasm-pack build --release --target web --no-typescript --out-dir build/pkg; \
	rm -f build/pkg/.gitignore build/pkg/package.json; \
	cp -r www/. build/; \
	cd -; \

# fetch Select Subject's models and their runtime into npaint/build. They are
# NOT committed (see .gitignore): this target pulls them, skipping whatever is
# already there, and `deploy_npaint` runs it first so the deploy has them.
# MODELS=core leaves out the 179 MB "Best" one.
ORT_VERSION := 1.20.1
ORT_CDN := https://cdn.jsdelivr.net/npm/onnxruntime-web@$(ORT_VERSION)/dist
# The U-2-Net family, Apache-2.0, as published by the rembg project.
MODEL_CDN := https://github.com/danielgatis/rembg/releases/download/v0.0.0
MODELS := all
NPAINT_MODELS := u2netp silueta $(if $(filter all,$(MODELS)),isnet-general-use,)

fetch_npaint_model:
	mkdir -p npaint/build/vendor/ort npaint/build/models
	for f in ort.wasm.min.mjs ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm; do \
		test -s npaint/build/vendor/ort/$$f || curl -sSL -o npaint/build/vendor/ort/$$f $(ORT_CDN)/$$f || exit 1; \
	done
	for m in $(NPAINT_MODELS); do \
		test -s npaint/build/models/$$m.onnx || curl -sSL -o npaint/build/models/$$m.onnx $(MODEL_CDN)/$$m.onnx || exit 1; \
	done
	@echo "NPaint has onnxruntime-web $(ORT_VERSION) and: $(NPAINT_MODELS)"

# run the NPaint engine's unit tests, natively (no browser, no wasm)
test_npaint:
	cd ./npaint; \
	cargo test; \
	cargo clippy --all-targets -- -D warnings; \
	cd -; \

# serve the built NPaint on :8790 (run build_npaint first)
run_npaint:
	@test -f npaint/build/pkg/npaint_bg.wasm || { echo "No build yet: run make build_npaint"; exit 1; }
	python3 -m http.server 8790 -d npaint/build

# install the nt CLI into the current environment, editable
install_nt:
	pip install -e ./cli

# clean node modules and build folders
clean:
	rm -rf app/node_modules
	rm -rf app/package-lock.json
	rm -rf app/build
	rm -rf app/build-hextool
	rm -rf app/build-uploadthat
	rm -rf npaint/target

# install deps from the lockfile
install:
	cd ./app; \
	npm install --frozen-lockfile; \
	cd -; \

# install the app, regens the lock file
lock:
	cd ./app; \
	npm install; \
	cd -; \

# run the unit tests in app/tests
test:
	cd ./app; \
	npm test; \
	cd -; \

# run the unit tests, re-running them as files change
test_watch:
	cd ./app; \
	npm run test:watch; \
	cd -; \

# regenerate public/posts/index.json from the markdown in public/posts
posts:
	cd ./app; \
	npm run posts; \
	cd -; \

# creates a built (HTML) version the react app
build:
	cd ./app; \
	npm run build; \
	cd -; \

# creates a built (HTML) version of the hex tool, for its own subdomain
build_hextool:
	cd ./app; \
	npm run build:hextool; \
	cd -; \

# creates a built version of uploadthat, front end plus PHP API
build_uploadthat:
	cd ./app; \
	npm run build:uploadthat; \
	cd -; \

# build every deployable
build_all: build build_hextool build_uploadthat build_npaint

# prod only, sends the built app to the folder where the site is hosted
deploy_manual:
	rm -rf /home/nteagvxe/public_html/*; \
	cp -r app/build/* /home/nteagvxe/public_html/; \
	echo "Deployed successfully!"; \

# Override the path if cPanel put the subdomain somewhere else:
#   make deploy_hextool HEXTOOL_DEPLOYPATH=/home/nteagvxe/some/other/dir
# prod only, sends the built hex tool to its subdomain's document root
HEXTOOL_DEPLOYPATH ?= /home/nteagvxe/public_hextool_html
deploy_hextool:
	test -d $(HEXTOOL_DEPLOYPATH) || { echo "No such directory: $(HEXTOOL_DEPLOYPATH)"; exit 1; }; \
	rm -rf $(HEXTOOL_DEPLOYPATH)/*; \
	cp -r app/build-hextool/* $(HEXTOOL_DEPLOYPATH)/; \
	echo "Deployed hex tool to $(HEXTOOL_DEPLOYPATH)"; \

# The data directory is deliberately NOT under this path: it has to survive the
# wipe, and uploads under the document root would be reachable by URL.
# prod only, sends the built uploadthat (front end + PHP API) to its subdomain
UPLOADTHAT_DEPLOYPATH ?= /home/nteagvxe/public_uploadthat_html
deploy_uploadthat:
	test -d $(UPLOADTHAT_DEPLOYPATH) || { echo "No such directory: $(UPLOADTHAT_DEPLOYPATH)"; exit 1; }; \
	rm -rf $(UPLOADTHAT_DEPLOYPATH)/*; \
	cp -r app/build-uploadthat/. $(UPLOADTHAT_DEPLOYPATH)/; \
	echo "Deployed uploadthat to $(UPLOADTHAT_DEPLOYPATH)"; \

# The data directory is deliberately NOT under this path: releases have to
# survive the wipe, and artifacts under the document root would be downloadable
# by URL with no token at all.
#
# public/ holds the management UI and becomes the document root; api/ goes
# under it. tests/ and config.sample.php are not deployed.
# prod only, sends the registry (API + UI) to its subdomain
REGISTRY_DEPLOYPATH ?= /home/nteagvxe/public_api_html
deploy_registry:
	test -d $(REGISTRY_DEPLOYPATH) || { echo "No such directory: $(REGISTRY_DEPLOYPATH)"; exit 1; }; \
	rm -rf $(REGISTRY_DEPLOYPATH)/*; \
	cp -r php/registry/public/. $(REGISTRY_DEPLOYPATH)/; \
	cp -r php/registry/api $(REGISTRY_DEPLOYPATH)/; \
	echo "Deployed registry to $(REGISTRY_DEPLOYPATH)"; \

# prod only, sends the built NPaint page to its subdomain's document root
NPAINT_DEPLOYPATH ?= /home/nteagvxe/public_npaint_html
deploy_npaint:
	test -d $(NPAINT_DEPLOYPATH) || { echo "No such directory: $(NPAINT_DEPLOYPATH)"; exit 1; }
	# The models are not in the repository, so fetch whatever is missing first.
	# A failure here is not fatal: Select Subject falls back to the built-in
	# search, and the rest of the editor does not care.
	-$(MAKE) fetch_npaint_model
	rm -rf $(NPAINT_DEPLOYPATH)/*; \
	cp -r npaint/build/. $(NPAINT_DEPLOYPATH)/; \
	echo "Deployed NPaint to $(NPAINT_DEPLOYPATH)"; \

# prod only, deploys the main site and every subdomain
deploy: deploy_manual deploy_hextool deploy_uploadthat deploy_registry deploy_npaint
