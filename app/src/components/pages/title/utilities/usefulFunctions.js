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

export const getRandomColour = () => {
  return `#${Math.floor((Math.random() * 0.5 + 0.5) * 16777215)
    .toString(16)
    .padStart(6, "0")}`;
};

// arduino map
export const scaleValue = (val, input_min, input_max, output_min, output_max) => {
  return (val - input_min) * (output_max - output_min) / (input_max - input_min) + output_min;
}

export const checkMouseInRadius = (pos_1, mouse_pos, check_radius) => {
  const dx = pos_1.x - mouse_pos.x;
  const dy = pos_1.y - mouse_pos.y;
  return Math.sqrt(dx ** 2 + dy ** 2) < check_radius;
}

export const getMiddleOfRectangle = (x, y, width, height) => {
  return { x: x + width / 2, y: y + height / 2 }
}
