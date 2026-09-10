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
build_all: build build_hextool build_uploadthat

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

# prod only, deploys the main site and every subdomain
deploy: deploy_manual deploy_hextool deploy_uploadthat deploy_registry
