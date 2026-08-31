// Matchers for asserting on DOM nodes, the same ones CRA wires up for tests
// that live under src.
import "@testing-library/jest-dom";

// jsdom does not expose TextEncoder/TextDecoder, which every browser has and
// which the uploadthat client uses to base64 non-ASCII filenames safely. Node
// has them; this just puts them where the code expects to find them.
const { TextEncoder, TextDecoder } = require("util");
if (typeof global.TextEncoder === "undefined") global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === "undefined") global.TextDecoder = TextDecoder;
