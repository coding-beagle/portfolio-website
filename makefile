run: 
	cd app && npm start

clean:
	rm -rf app/node_modules
	rm -rf app/package-lock.json
	rm -rf app/build

install:
	cd ./app; \
	npm install --frozen-lockfile; \
	cd -; \

lock:
	cd ./app; \
	npm install; \
	cd -; \

build:
	cd ./app; \
	npm run build; \
	cd -; \

deploy_manual:
	make install; \
	rm -rf /home/nteagvxe/public_html/*; \
	make build; \
	echo "Deployed successfully!"; \

deploy:
	git fetch origin
	if ! git diff --quiet origin/main; then \
		echo "Your branch is behind the remote branch."; \
		git pull origin main; \
		/home/nteagvxe/.nvm/versions/node/v23.9.0/bin/npm ci; \
		rm -rf /home/nteagvxe/public_html/*; \
		/home/nteagvxe/.nvm/versions/node/v23.9.0/bin/npm run build 2>&1 | tee /home/nteagvxe/deploy.log; \
		if [ $$? -eq 0 ]; then \
			echo "Deployed successfully!"; \
		else \
			echo "Deploy failed, check deploy.log for details"; \
		fi \
	fi