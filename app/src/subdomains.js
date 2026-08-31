import { faHashtag } from "@fortawesome/free-solid-svg-icons";

/**
 * The utilities that live on their own subdomains.
 *
 * Shared by both builds — the desktop scene is built from this list, so a new tool is one entry here
 * and nothing else. `localPath` is where the same page can be found inside the
 * portfolio bundle — the desktop then still opens something when it is being
 * run from localhost, where the subdomains do not exist.
 */
export const SUBDOMAIN_APPS = [
  {
    key: "hextool",
    name: "hex tool",
    icon: faHashtag,
    description: "Hex, binary and Verilog bit selects",
    url: "https://hextool.nteague.com",
    localPath: "#/hextool",
  },
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", ""]);

export const isLocalHost = () =>
  typeof window !== "undefined" && LOCAL_HOSTS.has(window.location.hostname);

/** Where an app should point right now — the subdomain, or its local stand-in. */
export const appHref = (app) =>
  isLocalHost() && app.localPath ? app.localPath : app.url;

/**
 * Opens an app. Kept here rather than inline in the scene so the desktop can be
 * handed a different launcher in tests, instead of navigating the test runner.
 */
export const launchApp = (app) => {
  window.location.href = appHref(app);
};

/** The portfolio, opened on the desktop the utilities are launched from. */
const HOME_URL = "https://www.nteague.com/#/?scene=desktop";

// True in the build that is deployed to a utility's subdomain, where the
// portfolio is a different origin and has to be reached by its full URL.
const IS_SUBDOMAIN_BUILD = process.env.REACT_APP_TARGET === "hextool";

/**
 * Where "back to the desktop" should point. Within the portfolio's own build on
 * localhost that is a hash away; from a subdomain it is another origin.
 */
export const homeHref = () =>
  !IS_SUBDOMAIN_BUILD && isLocalHost() ? "#/?scene=desktop" : HOME_URL;
