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
	make build; \
	rm -rf /home/nteagvxe/public_html/*; \
	cp -r app/build/* /home/nteagvxe/public_html/; \
	echo "Deployed successfully!"; \

deploy:
	git fetch origin
	if ! git diff --quiet origin/main; then \
		echo "Your branch is behind the remote branch."; \
		git pull origin main; \
		make install; \
		make build; \
		rm -rf /home/nteagvxe/public_html/*; \
		cp -r app/build/* /home/nteagvxe/public_html/; \
		echo "Deployed successfully!"; \
	fi