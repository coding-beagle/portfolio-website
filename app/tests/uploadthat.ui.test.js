/**
 * The uploadthat page: opening a session, joining one, and what the file list
 * does once the poll comes back.
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UploadThat, {
  codeFromHash,
  formatBytes,
  formatCountdown,
} from "../src/components/pages/uploadthat/UploadThat";
import { ThemeProvider } from "../src/themes/ThemeProvider";
import { MobileContext } from "../src/contexts/MobileContext";
import { encodeMeta } from "../src/components/pages/uploadthat/api";

const SESSION = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  code: "482913",
  token: "tok",
  role: "owner",
  expiresAt: Math.floor(Date.now() / 1000) + 900,
};

/**
 * Routes fetch by URL rather than by call order: the page polls on a timer, so
 * a queue of responses would drift depending on how many ticks a test took.
 */
function routeFetch(routes) {
  global.fetch = jest.fn((url, options = {}) => {
    const match = Object.keys(routes).find((pattern) => url.includes(pattern));
    const handler = match ? routes[match] : null;
    if (!handler) {
      return Promise.resolve({
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: () => Promise.resolve({ error: { code: "not_found", message: "No." } }),
      });
    }
    const result = handler(url, options);
    return Promise.resolve({
      ok: (result.status ?? 200) < 400,
      status: result.status ?? 200,
      headers: { get: (name) => (result.headers || {})[name] ?? null },
      json: () => Promise.resolve(result.body ?? {}),
    });
  });
}

const mount = () =>
  render(
    <MobileContext.Provider value={false}>
      <ThemeProvider>
        <UploadThat />
      </ThemeProvider>
    </MobileContext.Provider>
  );

beforeEach(() => {
  window.location.hash = "";
});

afterEach(() => {
  delete global.fetch;
  jest.useRealTimers();
});

describe("helpers", () => {
  it("reads a join code out of a scanned link, and nothing else", () => {
    expect(codeFromHash("#/j/482913")).toBe("482913");
    expect(codeFromHash("#/j/48291")).toBeNull();
    expect(codeFromHash("#/hextool")).toBeNull();
    expect(codeFromHash("")).toBeNull();
  });

  it("sizes files the way people read them", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
  });

  it("counts down in minutes and seconds", () => {
    expect(formatCountdown(900)).toBe("15:00");
    expect(formatCountdown(65)).toBe("1:05");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5)).toBe("0:00");
  });
});

describe("opening a session", () => {
  it("shows the code and a QR once the session exists", async () => {
    routeFetch({
      "/api/session": (url) =>
        url.endsWith("/manifest")
          ? { body: { version: 1, expiresAt: SESSION.expiresAt, files: [] } }
          : { status: 201, body: SESSION },
    });

    mount();
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));

    expect(await screen.findByText("482913")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /QR code/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /End session/ })).toBeInTheDocument();
  });

  it("only sends the operator key once it has been revealed and typed", async () => {
    let sent = null;
    routeFetch({
      "/api/session": (url, options) => {
        if (url.endsWith("/manifest")) {
          return { body: { version: 1, expiresAt: SESSION.expiresAt, files: [] } };
        }
        sent = JSON.parse(options.body);
        return { status: 201, body: SESSION };
      },
    });

    mount();
    userEvent.click(screen.getByText("I have a key"));
    fireEvent.change(screen.getByLabelText("Operator key"), {
      target: { value: "hunter2" },
    });
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));

    await screen.findByText("482913");
    expect(sent).toEqual({ operatorKey: "hunter2" });
  });

  it("explains a refusal instead of failing silently", async () => {
    routeFetch({
      "/api/session": () => ({
        status: 429,
        body: { error: { code: "rate_limited", message: "You have opened too many sessions." } },
      }),
    });

    mount();
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You have opened too many sessions."
    );
  });
});

describe("joining", () => {
  it("will not submit until six digits are in", () => {
    routeFetch({});
    mount();
    const join = screen.getByRole("button", { name: "Join" });
    expect(join).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Six-digit join code"), {
      target: { value: "4829" },
    });
    expect(join).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Six-digit join code"), {
      target: { value: "482913" },
    });
    expect(join).toBeEnabled();
  });

  it("keeps only digits, and only six of them", () => {
    routeFetch({});
    mount();
    const input = screen.getByLabelText("Six-digit join code");
    fireEvent.change(input, { target: { value: "4a8b2c9d1e3f7" } });
    expect(input).toHaveValue("482913");
  });

  it("joins straight away when arriving from a scanned QR", async () => {
    window.location.hash = "#/j/482913";
    routeFetch({
      "/api/join/482913": () => ({
        status: 200,
        body: { ...SESSION, role: "guest" },
      }),
      "/manifest": () => ({ body: { version: 1, expiresAt: SESSION.expiresAt, files: [] } }),
    });

    mount();
    expect(await screen.findByText("482913")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Leave session/ })).toBeInTheDocument();
  });
});

describe("the file list", () => {
  const withFiles = (files) =>
    routeFetch({
      "/manifest": () => ({
        headers: { ETag: '"v2-1111"' },
        body: { version: 2, expiresAt: SESSION.expiresAt, files },
      }),
      "/api/session": () => ({ status: 201, body: SESSION }),
    });

  it("shows what the other device added, by name and size", async () => {
    withFiles([
      {
        id: "aaaaaaaa-1111-4111-8111-111111111111",
        size: 2048,
        meta: encodeMeta({ name: "holiday.jpg", type: "image/jpeg" }),
        uploadedBy: "Device 2",
      },
    ]);

    mount();
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));

    expect(await screen.findByText("holiday.jpg")).toBeInTheDocument();
    expect(screen.getByText("2 KB · from Device 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download holiday.jpg" })).toBeInTheDocument();
  });

  it("says so when the session is empty rather than showing nothing", async () => {
    withFiles([]);
    mount();
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));
    expect(
      await screen.findByText(/Nothing here yet/)
    ).toBeInTheDocument();
  });
});
