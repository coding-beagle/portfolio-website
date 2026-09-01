/**
 * Remembering the operator key on this device.
 *
 * Only ever written after the server has accepted it, so a typo is never what
 * gets remembered. It is stored in localStorage, which means it is readable by
 * anything running on this origin — worth knowing, though the key only raises
 * quotas: it decrypts nothing and opens no session that is not yours already.
 *
 * Every accessor is wrapped, because storage throws rather than returns null in
 * a private window or with site data blocked, and a page that will not load
 * because it could not read a convenience is a bad trade.
 */
const KEY = "uploadthat.operatorKey";

export function rememberedKey() {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch (error) {
    return "";
  }
}

export function rememberKey(value) {
  try {
    window.localStorage.setItem(KEY, value);
  } catch (error) {
    // A device that will not remember it is a device that asks each time.
  }
}

export function forgetKey() {
  try {
    window.localStorage.removeItem(KEY);
  } catch (error) {
    // Nothing to do: there was nothing to forget.
  }
}
