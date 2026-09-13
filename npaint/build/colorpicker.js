// A colour picker: a hue ring around a saturation/value square, with hex
// and RGB fields and a strip of recent colours. Pure UI — the engine only
// ever sees the resulting hex string.

const SIZE = 190;
const OUTER = SIZE / 2 - 2;
const INNER = OUTER - 20;
const SQUARE = Math.floor(INNER * Math.SQRT2) - 6;

export function hsvToRgb(h, s, v) {
  const c = v * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [r + m, g + m, b + m].map((n) => Math.round(n * 255));
}

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : d / max, max];
}

export const toHex = (r, g, b) => "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");

export function parseHex(text) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Creates the picker inside `root` (a hidden popover element). `open`
 * shows it anchored to an element with an initial hex; `onChange` fires
 * for every change, `onClose` when it is dismissed.
 */
export function createColorPicker(root, { onChange }) {
  let h = 0, s = 0, v = 0;
  let original = "#000000";
  let recent = [];
  let dragging = null; // "ring" | "square"
  const dpr = window.devicePixelRatio || 1;

  root.innerHTML = `
    <canvas class="color-wheel" width="${SIZE * dpr}" height="${SIZE * dpr}"></canvas>
    <div class="color-fields">
      <label for="cp-hex">Hex</label><input id="cp-hex" type="text" maxlength="7" />
      <label for="cp-r">R</label><input id="cp-r" type="number" min="0" max="255" />
      <label for="cp-g">G</label><input id="cp-g" type="number" min="0" max="255" />
      <label for="cp-b">B</label><input id="cp-b" type="number" min="0" max="255" />
      <label for="cp-h">H</label><input id="cp-h" type="number" min="0" max="360" />
      <label for="cp-s">S</label><input id="cp-s" type="number" min="0" max="100" />
      <label for="cp-v">V</label><input id="cp-v" type="number" min="0" max="100" />
      <div class="color-preview"><span class="old"></span><span class="new"></span></div>
      <div class="color-recent"></div>
    </div>`;
  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const field = (id) => root.querySelector("#" + id);
  const ring = document.createElement("canvas");
  ring.width = ring.height = SIZE * dpr;
  paintRing(ring.getContext("2d"), dpr);

  function current() {
    const [r, g, b] = hsvToRgb(h, s, v);
    return toHex(r, g, b);
  }

  function setHsv(nh, ns, nv, { fire = true } = {}) {
    h = ((nh % 360) + 360) % 360;
    s = Math.min(1, Math.max(0, ns));
    v = Math.min(1, Math.max(0, nv));
    render();
    if (fire) onChange(current());
  }

  function setHex(hex, opts) {
    const rgb = parseHex(hex);
    if (!rgb) return;
    const [nh, ns, nv] = rgbToHsv(...rgb);
    // Keep the hue when the colour is grey, so the ring does not jump.
    setHsv(ns === 0 ? h : nh, ns, nv, opts);
  }

  function render() {
    const [r, g, b] = hsvToRgb(h, s, v);
    field("cp-hex").value = toHex(r, g, b);
    field("cp-r").value = r; field("cp-g").value = g; field("cp-b").value = b;
    field("cp-h").value = Math.round(h); field("cp-s").value = Math.round(s * 100); field("cp-v").value = Math.round(v * 100);
    root.querySelector(".color-preview .old").style.background = original;
    root.querySelector(".color-preview .new").style.background = toHex(r, g, b);
    paint();
  }

  function paint() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(ring, 0, 0, SIZE, SIZE);
    const c = SIZE / 2;
    // SV square: hue at full, white → hue across, black down.
    const x0 = c - SQUARE / 2, y0 = c - SQUARE / 2;
    const [hr, hg, hb] = hsvToRgb(h, 1, 1);
    ctx.fillStyle = `rgb(${hr},${hg},${hb})`;
    ctx.fillRect(x0, y0, SQUARE, SQUARE);
    const white = ctx.createLinearGradient(x0, 0, x0 + SQUARE, 0);
    white.addColorStop(0, "rgba(255,255,255,1)");
    white.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = white;
    ctx.fillRect(x0, y0, SQUARE, SQUARE);
    const black = ctx.createLinearGradient(0, y0, 0, y0 + SQUARE);
    black.addColorStop(0, "rgba(0,0,0,0)");
    black.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = black;
    ctx.fillRect(x0, y0, SQUARE, SQUARE);
    // Markers.
    const a = (h * Math.PI) / 180;
    const rm = (OUTER + INNER) / 2;
    marker(c + rm * Math.cos(a), c + rm * Math.sin(a));
    marker(x0 + s * SQUARE, y0 + (1 - v) * SQUARE);
  }

  function marker(x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function pointerToLocal(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function applyPointer(x, y) {
    const c = SIZE / 2;
    if (dragging === "ring") {
      setHsv((Math.atan2(y - c, x - c) * 180) / Math.PI, s, v);
    } else if (dragging === "square") {
      const x0 = c - SQUARE / 2, y0 = c - SQUARE / 2;
      setHsv(h, (x - x0) / SQUARE, 1 - (y - y0) / SQUARE);
    }
  }

  canvas.addEventListener("pointerdown", (e) => {
    const [x, y] = pointerToLocal(e);
    const c = SIZE / 2;
    const d = Math.hypot(x - c, y - c);
    if (d >= INNER - 2 && d <= OUTER + 2) dragging = "ring";
    else if (Math.abs(x - c) <= SQUARE / 2 + 2 && Math.abs(y - c) <= SQUARE / 2 + 2) dragging = "square";
    else return;
    canvas.setPointerCapture(e.pointerId);
    applyPointer(x, y);
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging) applyPointer(...pointerToLocal(e));
  });
  const stop = () => (dragging = null);
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);

  field("cp-hex").addEventListener("change", () => setHex(field("cp-hex").value));
  for (const id of ["cp-r", "cp-g", "cp-b"]) {
    field(id).addEventListener("input", () => {
      const rgb = ["cp-r", "cp-g", "cp-b"].map((k) => Math.min(255, Math.max(0, Number(field(k).value) || 0)));
      const [nh, ns, nv] = rgbToHsv(...rgb);
      setHsv(ns === 0 ? h : nh, ns, nv);
    });
  }
  for (const id of ["cp-h", "cp-s", "cp-v"]) {
    field(id).addEventListener("input", () => {
      setHsv(Number(field("cp-h").value) || 0, (Number(field("cp-s").value) || 0) / 100, (Number(field("cp-v").value) || 0) / 100);
    });
  }
  root.querySelector(".color-preview .old").addEventListener("click", () => setHex(original));

  function renderRecent() {
    const strip = root.querySelector(".color-recent");
    strip.replaceChildren();
    for (const hex of recent) {
      const b = document.createElement("button");
      b.style.background = hex;
      b.title = hex;
      b.addEventListener("click", () => setHex(hex));
      strip.appendChild(b);
    }
  }

  function remember(hex) {
    recent = [hex, ...recent.filter((c) => c !== hex)].slice(0, 12);
    renderRecent();
  }

  let closeHandler = null;

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    remember(current());
    window.removeEventListener("pointerdown", closeHandler, true);
    closeHandler = null;
  }

  function open(anchor, hex) {
    original = hex;
    setHex(hex, { fire: false });
    root.hidden = false;
    const r = anchor.getBoundingClientRect();
    root.style.left = `${Math.min(r.right + 8, window.innerWidth - root.offsetWidth - 8)}px`;
    root.style.top = `${Math.min(r.top, window.innerHeight - root.offsetHeight - 8)}px`;
    closeHandler = (e) => {
      if (!root.contains(e.target) && !anchor.contains(e.target)) close();
    };
    window.addEventListener("pointerdown", closeHandler, true);
    field("cp-hex").focus();
    field("cp-hex").select();
  }

  return { open, close, isOpen: () => !root.hidden };
}

function paintRing(ctx, dpr) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const c = SIZE / 2;
  for (let deg = 0; deg < 360; deg += 1) {
    const [r, g, b] = hsvToRgb(deg, 1, 1);
    ctx.beginPath();
    ctx.arc(c, c, OUTER, ((deg - 0.6) * Math.PI) / 180, ((deg + 1.2) * Math.PI) / 180);
    ctx.arc(c, c, INNER, ((deg + 1.2) * Math.PI) / 180, ((deg - 0.6) * Math.PI) / 180, true);
    ctx.closePath();
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fill();
  }
}
