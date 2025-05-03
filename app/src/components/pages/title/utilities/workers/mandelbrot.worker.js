// eslint-disable-next-line import/no-anonymous-default-export
export default () => {
  // eslint-disable-next-line no-restricted-globals
  self.addEventListener("message", (event) => {
    const data = event.data;
    const result = calculateMandelbrot(
      data.pixelX,
      data.pixelY,
      data.zoomLevel,
      data.transformX,
      data.transformY,
      data.canvasWidth,
      data.canvasHeight,
      data.centerX,
      data.centerY
    );
    // eslint-disable-next-line no-restricted-globals
    self.postMessage(result);
  });

  function calculateMandelbrot(
    pixelX,
    pixelY,
    zoomLevel,
    transformX,
    transformY,
    canvasWidth,
    canvasHeight,
    centerX,
    centerY
  ) {
    const c = mapToComplex(
      pixelX,
      pixelY,
      zoomLevel,
      transformX,
      transformY,
      canvasWidth,
      canvasHeight,
      centerX,
      centerY
    ); // real or fake it is what it is ykwim
    const cX = c[0];
    const cY = c[1];
    let zReal = 0;
    let zIm = 0;
    let count = 0;
    let nextZReal, nextZIm;
    while (zReal ** 2 + zIm ** 2 <= 4 && count < 1000) {
      nextZReal = zReal * zReal - zIm * zIm + cX;
      nextZIm = 2 * zReal * zIm + cY;

      zReal = nextZReal;
      zIm = nextZIm;

      count += 1;
    }

    return count;
  }

  function mapToComplex(
    pixelX,
    pixelY,
    zoomLevel,
    transformX,
    transformY,
    canvasWidth,
    canvasHeight,
    centerX,
    centerY
  ) {
    // Calculate the view dimensions in the complex plane
    const viewWidth = 4 / zoomLevel; // 4 units wide at zoom level 1
    const viewHeight = 2.25 / zoomLevel; // 2.25 units high at zoom level 1

    // Convert pixel coordinates to percentages of canvas
    const percentX = (pixelX + transformX) / canvasWidth;
    const percentY = (pixelY + transformY) / canvasHeight;

    // Map to complex plane coordinates, centered on centerX,centerY
    return [
      centerX + (percentX - 0.5) * viewWidth,
      centerY + (percentY - 0.5) * viewHeight,
    ];
  }
};
