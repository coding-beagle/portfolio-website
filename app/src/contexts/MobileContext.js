import { createContext } from "react";

const MobileContext = createContext();

/**
 * Whether the page is being viewed on a touch/handset browser. Shared by both
 * builds so the portfolio and the hex tool agree on what counts as mobile.
 */
const isMobile = () =>
  typeof window !== "undefined" &&
  /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );

export { MobileContext, isMobile };
