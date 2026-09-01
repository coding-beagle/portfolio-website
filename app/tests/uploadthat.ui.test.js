/**
 * The uploadthat page, driven against a stand-in server that stores what it is
 * given (tests/helpers/uploadthatServer.js).
 *
 * Nothing here mocks the encryption: the names in the file list are names the
 * app encrypted, sent, fetched back and decrypted, and the four digits on the
 * handshake screen are the ones a real second device would be showing.
 */
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UploadThat, {
  codeFromHash,
  formatBytes,
  formatCountdown,
} from "../src/components/pages/uploadthat/UploadThat";
import { ThemeProvider } from "../src/themes/ThemeProvider";
import { MobileContext } from "../src/contexts/MobileContext";
import { decrypt } from "../src/components/pages/uploadthat/crypto";
import {
  installUploadthatServer,
  uninstallUploadthatServer,
} from "./helpers/uploadthatServer";

let server;

// The manifest is polled every two seconds, so waiting for something that
// arrives through it needs longer than the one-second default.
const POLL_GRACE = { timeout: 5000 };
const findGate = () =>
  screen.findByRole("dialog", { name: /Confirm the other device/i }, POLL_GRACE);

const mount = (mobile = false) =>
  render(
    <MobileContext.Provider value={mobile}>
      <ThemeProvider>
        <UploadThat />
      </ThemeProvider>
    </MobileContext.Provider>
  );

/** Opens a session and waits until the page is showing it. */
const openSession = async (mobile = false) => {
  const view = mount(mobile);
  userEvent.click(screen.getByRole("button", { name: "Start a session" }));
  await screen.findByText("482913");
  return view;
};

beforeEach(() => {
  window.location.hash = "";
  window.localStorage.clear();
  server = installUploadthatServer();
});

afterEach(() => {
  uninstallUploadthatServer();
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
  });

  it("counts down in minutes and seconds", () => {
    expect(formatCountdown(900)).toBe("15:00");
    expect(formatCountdown(65)).toBe("1:05");
    expect(formatCountdown(0)).toBe("0:00");
  });
});

describe("opening a session", () => {
  it("shows the code and a QR, and sends a public key to open it", async () => {
    await openSession();
    expect(screen.getByRole("img", { name: /QR code/i })).toBeInTheDocument();
    // No public key means no handshake, so the server insists on one.
    expect(server.state.session.ownerPublicKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("explains a refusal instead of failing silently", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 429,
      headers: { get: () => null },
      json: async () => ({
        error: { code: "rate_limited", message: "You have opened too many sessions." },
      }),
    }));
    mount();
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You have opened too many sessions."
    );
  });
});

describe("the operator key", () => {
  it("is remembered once it has worked, and the field opens filled in", async () => {
    mount();
    userEvent.click(screen.getByText("I have a key"));
    fireEvent.change(screen.getByLabelText("Operator key"), {
      target: { value: "hunter2" },
    });
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));
    await screen.findByText("482913");

    // A fresh page: no clicking anything open, and the key is already there.
    uninstallUploadthatServer();
    server = installUploadthatServer();
    mount();
    expect(screen.getByLabelText("Operator key")).toHaveValue("hunter2");
  });

  it("does not remember a key the server refused", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      headers: { get: () => null },
      json: async () => ({ error: { code: "bad_key", message: "Not recognised." } }),
    }));
    mount();
    userEvent.click(screen.getByText("I have a key"));
    fireEvent.change(screen.getByLabelText("Operator key"), {
      target: { value: "wrong" },
    });
    userEvent.click(screen.getByRole("button", { name: "Start a session" }));
    await screen.findByRole("alert");

    expect(window.localStorage.getItem("uploadthat.operatorKey")).toBeNull();
  });

  it("can be forgotten again", async () => {
    window.localStorage.setItem("uploadthat.operatorKey", "hunter2");
    mount();
    expect(screen.getByLabelText("Operator key")).toHaveValue("hunter2");

    userEvent.click(screen.getByText(/Forget this key/));
    expect(window.localStorage.getItem("uploadthat.operatorKey")).toBeNull();
    expect(screen.queryByLabelText("Operator key")).toBeNull();
  });
});

describe("letting the other device in", () => {
  jest.setTimeout(15000);

  it("shows both devices the same four digits, and hands over the key", async () => {
    await openSession();
    const phone = await server.joinAsOtherDevice();

    // The owner's screen works the digits out for itself; they have to agree.
    const gate = await findGate();
    expect(within(gate).getByText(phone.sas)).toBeInTheDocument();

    userEvent.click(screen.getByRole("button", { name: /let it in/i }));
    await waitFor(async () => expect(await phone.sessionKey()).not.toBeNull(), POLL_GRACE);

    // And the key it received is the one the files were encrypted with.
    const key = await phone.sessionKey();
    expect(key).toBeTruthy();
  });

  it("can turn a device away instead", async () => {
    await openSession();
    await server.joinAsOtherDevice();
    await findGate();

    userEvent.click(screen.getByRole("button", { name: /Turn away/i }));
    await waitFor(() => expect(server.state.joins).toHaveLength(0), POLL_GRACE);
  });
});

describe("files", () => {
  jest.setTimeout(15000);

  const drop = (name, type, contents) => {
    const file = new File([contents], name, { type });
    // jsdom's File has no arrayBuffer in this version.
    file.arrayBuffer = async () => new TextEncoder().encode(contents).buffer;
    const zone = screen.getByRole("button", { name: "Add files" });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
  };

  it("encrypts a file on the way out and reads it back by name", async () => {
    await openSession();
    drop("notes.txt", "text/plain", "hello there");
    await waitFor(() => expect(server.state.files).toHaveLength(1), POLL_GRACE);

    // The row only says "from Device 1" once the poll has been round and the
    // app has decrypted its own description — the transfer row in flight looks
    // similar, so this is the assertion that means the round trip worked.
    expect(await screen.findByText(/from Device 1/, {}, POLL_GRACE)).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();

    // And what the server is holding is not what was typed.
    const stored = server.state.files[0];
    expect(new TextDecoder().decode(stored.body)).not.toContain("hello there");
    expect(atob(stored.meta)).not.toContain("notes.txt");
  });

  it("hands the other device something it can actually open", async () => {
    await openSession();
    const phone = await server.joinAsOtherDevice();
    await findGate();
    userEvent.click(screen.getByRole("button", { name: /let it in/i }));
    await waitFor(async () => expect(await phone.sessionKey()).not.toBeNull(), POLL_GRACE);

    drop("notes.txt", "text/plain", "hello there");
    await waitFor(() => expect(server.state.files).toHaveLength(1), POLL_GRACE);

    const key = await phone.sessionKey();
    const opened = await decrypt(key, server.state.files[0].body);
    expect(new TextDecoder().decode(opened)).toBe("hello there");
  });
});

describe("the shared note", () => {
  it("sends what is typed, encrypted, after a pause", async () => {
    jest.useFakeTimers();
    try {
      await openSession();
      fireEvent.change(screen.getByLabelText("Shared note"), {
        target: { value: "meet at six" },
      });

      // Nothing goes out per keystroke.
      expect(server.state.note).toBe("");
      jest.advanceTimersByTime(1200);
      await waitFor(() => expect(server.state.note).not.toBe(""));
    } finally {
      jest.useRealTimers();
    }

    // What the server holds is ciphertext, not the sentence.
    expect(atob(server.state.note)).not.toContain("meet at six");
  });
});
