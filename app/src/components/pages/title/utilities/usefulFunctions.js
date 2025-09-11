export const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

export const colourToRGB = (colourHex) => {
  return {
    r: parseInt(colourHex.slice(1, 3), 16),
    g: parseInt(colourHex.slice(3, 5), 16),
    b: parseInt(colourHex.slice(5, 7), 16),
  };
}

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

export const inRect = (rect, x, y, radius) => {
  const closestX = clamp(x, rect.left, rect.right);
  const closestY = clamp(y, rect.top, rect.bottom);

  const distanceX = x - closestX;
  const distanceY = y - closestY;
  const distanceSquared = distanceX * distanceX + distanceY * distanceY;

  return distanceSquared <= radius * radius;
};

export const padRect = (rect, pad_amount_x, pad_amount_y) => {
  return {
    left: rect.left - pad_amount_x, right: rect.right + pad_amount_x,
    top: rect.top - pad_amount_y, bottom: rect.bottom + pad_amount_y
  }
}

export const drawCircleAt = (ctx, x, y, size, color) => {
  ctx.save();

  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.closePath();

  ctx.restore();
}

export const DIRECTIONS = {
  NW: 0,
  N: 1,
  NE: 2,
  E: 3,
  SE: 4,
  S: 5,
  SW: 6,
  W: 7
};

// assume that we're treating the array as width-wise
export const getNeighbourIndexFromGrid = (gridWidth, gridHeight, direction, currentIndex) => {

  // console.log("called with", { gridWidth: gridWidth, gridHeight: gridHeight, direction: direction, currentIndex: currentIndex })
  switch (direction) {
    case DIRECTIONS.NW:

      // only have NW neighbour if cell is not on left side or top
      if (currentIndex < gridWidth) return -1;
      if (currentIndex % gridWidth === 0) return -1;

      return currentIndex - gridWidth - 1;
    case DIRECTIONS.N:

      // only have a north neighbour if cell is not on top row
      if (currentIndex < gridWidth) return -1;

      return currentIndex - gridWidth;
    case DIRECTIONS.NE:

      // only have a NE neighbour if cell is not on top row or right most column
      if (currentIndex < gridWidth) return -1;
      if (currentIndex % gridWidth === gridWidth - 1) return -1;

      return currentIndex - gridWidth + 1;
    case DIRECTIONS.E:

      // only have a E neighbour if cell is not on rightmost column
      if (currentIndex % gridWidth === gridWidth - 1) return -1;
      return currentIndex + 1;
    case DIRECTIONS.SE:

      // only yadada
      if (currentIndex % gridWidth === gridWidth - 1) return -1;
      if (currentIndex >= gridWidth * (gridHeight - 1)) return -1;

      return currentIndex + gridWidth + 1;
    case DIRECTIONS.S:

      if (currentIndex >= gridWidth * (gridHeight - 1)) return -1;
      // console.log("returning: ", currentIndex + gridWidth)
      return currentIndex + gridWidth;
    case DIRECTIONS.SW:

      if (currentIndex >= gridWidth * (gridHeight - 1)) return -1;
      if (currentIndex % gridWidth === 0) return -1;

      return currentIndex + gridWidth - 1;
    case DIRECTIONS.W:

      if (currentIndex % gridWidth === 0) return -1;
      return currentIndex - 1;
    default:
      return -1;
  }
}

