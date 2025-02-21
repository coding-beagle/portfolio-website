run: 
	cd app && npm start

clean:
	rm -rf app/node_modules
	rm -rf app/package-lock.json

install:
	cd app && npm install