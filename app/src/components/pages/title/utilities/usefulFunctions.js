export const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

export const getCloseColour = (colourHex, varR = 10, varG = 5, varB = 5) => {
  const colour = {
    r: parseInt(colourHex.slice(1, 3), 16),
    g: parseInt(colourHex.slice(3, 5), 16),
    b: parseInt(colourHex.slice(5, 7), 16),
  };

  const r = Math.floor(clamp(colour.r + (Math.random() - 0.5) * varR, 0, 255));
  const g = Math.floor(clamp(colour.g + (Math.random() - 0.5) * varG, 0, 255));
  const b = Math.floor(clamp(colour.b + (Math.random() - 0.5) * varB, 0, 255));

  const rHex = r.toString(16).padStart(2, "0");
  const gHex = g.toString(16).padStart(2, "0");
  const bHex = b.toString(16).padStart(2, "0");

  return `#${rHex}${gHex}${bHex}`;
};
