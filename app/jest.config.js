/**
 * Unit tests live in ./tests, outside the app source.
 *
 * `react-scripts test` only crawls src — its `roots` is not one of the keys
 * Create React App lets you override — so the tests are run through Jest
 * directly. The transforms and jsdom polyfills are CRA's own, so test files go
 * through exactly the Babel setup the app is built with (JSX runtime included).
 */
const fromCra = (file) => require.resolve(`react-scripts/config/jest/${file}`);

module.exports = {
  rootDir: __dirname,
  roots: ["<rootDir>/tests"],
  testEnvironment: "jsdom",
  testMatch: ["<rootDir>/tests/**/*.test.js"],
  setupFiles: [require.resolve("react-app-polyfill/jsdom")],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.js"],
  transform: {
    "^.+\\.(js|jsx|mjs|cjs|ts|tsx)$": fromCra("babelTransform.js"),
    "^.+\\.css$": fromCra("cssTransform.js"),
    "^(?!.*\\.(js|jsx|mjs|cjs|ts|tsx|css|json)$)": fromCra("fileTransform.js"),
  },
  transformIgnorePatterns: [
    "[/\\\\]node_modules[/\\\\].+\\.(js|jsx|mjs|cjs|ts|tsx)$",
    "^.+\\.module\\.(css|sass|scss)$",
  ],
  modulePaths: [],
  moduleFileExtensions: ["js", "jsx", "json", "node"],
  resetMocks: true,
};
