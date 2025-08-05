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
	rm -rf /home/nteagvxe/public_html/*; \
	cp app/build/* /home/nteagvxe/public_html/; \
	echo "Deployed successfully!"; \