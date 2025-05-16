// eslint-disable-next-line import/no-anonymous-default-export
export default () => {
  // eslint-disable-next-line no-restricted-globals
  self.addEventListener("message", (event) => {
    const data = event.data;
    const results = calculateMandelbrotRow(
      data.rowPixels,
      data.rowY, // Correctly pass rowY as a separate parameter
      data.zoomLevel,
      data.transformX,
      data.transformY,
      data.canvasWidth,
      data.canvasHeight,
      data.centerX,
      data.centerY,
      data.xAspectRatio,
      data.yAspectRatio
    );
    // eslint-disable-next-line no-restricted-globals
    self.postMessage({
      results,
      drawGeneration: data.drawGeneration, // Echo back the generation
    });
  });

  function calculateMandelbrotRow(
    rowPixels,
    rowY, // Correctly pass rowY as a separate parameter
    zoomLevel,
    transformX,
    transformY,
    canvasWidth,
    canvasHeight,
    centerX,
    centerY,
    xAspectRatio,
    yAspectRatio
  ) {
    return rowPixels.map((pixelX) =>
      calculateMandelbrot(
        pixelX,
        rowY, // Use rowY here
        zoomLevel,
        transformX,
        transformY,
        canvasWidth,
        canvasHeight,
        centerX,
        centerY,
        xAspectRatio,
        yAspectRatio
      )
    );
  }

  function calculateMandelbrot(
    pixelX,
    pixelY,
    zoomLevel,
    transformX,
    transformY,
    canvasWidth,
    canvasHeight,
    centerX,
    centerY,
    xAspectRatio,
    yAspectRatio
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
      centerY,
      xAspectRatio,
      yAspectRatio
    ); // real or fake it is what it is ykwim
    const cX = c[0];
    const cY = c[1];
    let zReal = 0;
    let zIm = 0;
    let count = 0;
    let nextZReal, nextZIm;
    while (zReal ** 2 + zIm ** 2 <= 4 && count < 2000) {
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
    centerY,
    xAspectRatio,
    yAspectRatio
  ) {
    // Calculate the view dimensions in the complex plane
    const viewWidth = xAspectRatio / zoomLevel; // 4 units wide at zoom level 1
    const viewHeight = yAspectRatio / zoomLevel; // 2.25 units high at zoom level 1

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
