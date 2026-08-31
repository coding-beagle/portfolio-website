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

# clean node modules and build folders
clean:
	rm -rf app/node_modules
	rm -rf app/package-lock.json
	rm -rf app/build
	rm -rf app/build-hextool

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

# build both deployables
build_all: build build_hextool

# prod only, sends the built app to the folder where the site is hosted
deploy_manual:
	rm -rf /home/nteagvxe/public_html/*; \
	cp -r app/build/* /home/nteagvxe/public_html/; \
	echo "Deployed successfully!"; \

# prod only, sends the built hex tool to its subdomain's document root.
# Override the path if cPanel put the subdomain somewhere else:
#   make deploy_hextool HEXTOOL_DEPLOYPATH=/home/nteagvxe/some/other/dir
HEXTOOL_DEPLOYPATH ?= /home/nteagvxe/public_hextool_html
deploy_hextool:
	test -d $(HEXTOOL_DEPLOYPATH) || { echo "No such directory: $(HEXTOOL_DEPLOYPATH)"; exit 1; }; \
	rm -rf $(HEXTOOL_DEPLOYPATH)/*; \
	cp -r app/build-hextool/* $(HEXTOOL_DEPLOYPATH)/; \
	echo "Deployed hex tool to $(HEXTOOL_DEPLOYPATH)"; \