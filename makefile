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

# run the uploadthat API's own tests (needs php on PATH)
test_uploadthat:
	php php/uploadthat/tests/run.php

# check a DEPLOYED uploadthat over real HTTP: make smoke_uploadthat URL=https://...
URL ?= https://uploadthat.nteague.com
smoke_uploadthat:
	php/uploadthat/tests/smoke.sh "$(URL)" "$(OPERATOR_KEY)"

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

# prod only, deploys the main site and every subdomain
deploy: deploy_manual deploy_hextool deploy_uploadthat
