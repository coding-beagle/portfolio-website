run: 
	cd app && npm start

clean:
	rm -rf app/node_modules
	rm -rf app/package-lock.json
	rm -rf app/build

install:
	cd app && npm install

build:
	cd app && npm run build && cd -

deploy:
	cd app && npm install -g serve && serve -s ./build && cd -