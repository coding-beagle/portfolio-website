import React, { useContext, useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { MobileContext } from "../../../../contexts/MobileContext";

export default function Penguin({ visibleUI }) {
  const { theme, themeName } = useTheme();
  const canvasRef = useRef(null);
  const particleCountRef = useRef(200);
  const simulationSpeedRef = useRef(100);
  const colorRef = useRef(theme.accent);
  const [, setRender] = useState(0);

  const [skyImage, setSkyImage] = useState(() => {
    const isDark = themeName?.toLowerCase().includes('dark');
    return isDark ? 'penguin/sunsetsky_static.gif' : 'penguin/sky.gif';
  });
  const [skyKey, setSkyKey] = useState(0);
  const previousIsDarkRef = useRef(null);

  const isDark = themeName?.toLowerCase().includes('dark');

  // Handle theme changes and sky transitions
  useEffect(() => {
    if (previousIsDarkRef.current === null) {
      previousIsDarkRef.current = isDark;
      return;
    }

    const previousIsDark = previousIsDarkRef.current;
    const currentIsDark = isDark;

    if (previousIsDark !== currentIsDark) {
      const transitionGif = currentIsDark
        ? 'penguin/sunsetsky.gif'
        : 'penguin/sunsetskyreversed.gif';

      setSkyImage(transitionGif);
      setSkyKey(prev => prev + 1);

      const timer = setTimeout(() => {
        const staticGif = currentIsDark ? 'penguin/sunsetsky_static.gif' : 'penguin/sky.gif';
        setSkyImage(staticGif);
        setSkyKey(prev => prev + 1);
      }, 2000);

      previousIsDarkRef.current = currentIsDark;
      return () => clearTimeout(timer);
    }
  }, [isDark]);

  // Update colorRef and all particles' colors on theme change
  useEffect(() => {
    colorRef.current = theme.accent;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas._particles) {
      canvas._particles.forEach((particle) => {
        particle.color = theme.accent;
      });
    }
  }, [theme]);

  // For the sky - uses <img> with cache-busting to force restart
  const returnSkyGIF = (imgpath, cacheBust) => {
    const src = `${imgpath}?v=${cacheBust}`;

    return (
      <img
        src={src}
        alt=""
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          objectFit: 'cover',
          objectPosition: 'center top',
          imageRendering: 'pixelated',
          pointerEvents: 'none',
        }}
      />
    )
  }

  // For other GIFs - uses background-image (original approach)
  const returnGIFJSX = (imgpath, position, size = 'cover') => {
    return (
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        backgroundImage: `url(${imgpath})`,
        backgroundPosition: position,
        backgroundRepeat: 'no-repeat',
        backgroundSize: size,
        overflow: 'hidden',
        width: '100vw',
        height: '100vh',
        imageRendering: 'pixelated',
      }} />
    )
  }

  const mobile = useContext(MobileContext);

  return (
    <>
      {returnSkyGIF(skyImage, skyKey)}
      {returnGIFJSX('penguin/mountains.gif', 'center top')}
      {returnGIFJSX('penguin/snow.gif', 'center top')}
      {mobile ? returnGIFJSX('penguin/penguin.gif', '40% 100%', '200%') : returnGIFJSX('penguin/penguin.gif', '40% 100%', '50%')}
    </>
  );
}