import React, { useContext, useState } from "react";
import { MobileContext } from "../../../../../contexts/MobileContext";

/**
 * The fair-weather clouds over Bliss.
 *
 * Plain white circles sitting on a common baseline, and nothing else: no blur
 * and no shading. The rest of this wallpaper is flat shapes — one path for the
 * hill, flat discs for the sun and the moon — and clouds with soft edges and a
 * gradient in them were the one thing on the sky pretending to be a photograph.
 *
 * Every cloud is built at random, because five copies of one shape at five
 * sizes read as wallpaper in the other sense. The rolls are taken once and kept
 * for as long as the scene is up, so a theme toggle does not reshuffle the sky.
 *
 * They drift on a CSS animation rather than a frame loop: nothing else on the
 * wallpaper depends on where a cloud is, and a two hundred second crawl is not
 * worth waking the main thread sixty times a second for.
 */

const rand = (min, max) => min + Math.random() * (max - min);

/**
 * One cloud's balls: where each starts and how wide it is, as fractions of the
 * finished cloud. They are bottom-aligned, which is what gives the flat
 * underside a cloud needs to stop reading as a row of circles.
 */
const makePuffs = () => {
  const count = 3 + Math.floor(Math.random() * 3);
  const puffs = [];
  let x = 0;

  for (let index = 0; index < count; index += 1) {
    // A hump: the balls swell towards the middle of the run and taper off at
    // both ends. Sizes drawn flat out of a hat gave clouds that trailed away
    // into a big ball at one end, which is not a shape the sky makes.
    const along = index / (count - 1);
    const swell = 0.45 + 0.55 * Math.sin(Math.PI * along);
    const diameter = swell * rand(0.7, 1);
    puffs.push({ x, d: diameter });
    // Each ball starts part-way into the one before it, so the run stays joined
    // up instead of breaking into separate circles.
    x += diameter * rand(0.38, 0.62);
  }

  // Scaled so a cloud is exactly one wide however many balls it ended up with,
  // which is what lets the caller size it in pixels.
  const span = Math.max(...puffs.map((puff) => puff.x + puff.d));
  return puffs.map((puff) => ({ x: puff.x / span, d: puff.d / span }));
};

/**
 * Where each cloud sits, how big it is, and how long it takes to cross.
 *
 * The delay is negative, which starts a cloud part-way through its own
 * crossing — that is what spreads them across the sky on the first frame
 * instead of filing them in from the left edge one at a time.
 */
const makeClouds = () =>
  Array.from({ length: 4 + Math.floor(Math.random() * 3) }, () => {
    const seconds = rand(200, 420);
    return {
      puffs: makePuffs(),
      top: rand(2, 36),
      width: rand(110, 320),
      opacity: rand(0.55, 1),
      seconds,
      delay: -rand(0.05, 0.95) * seconds,
    };
  });

function Cloud({ puffs, width }) {
  const height = Math.max(...puffs.map((puff) => puff.d)) * width;

  return (
    <div data-cloud="" style={{ position: "relative", width, height }}>
      {puffs.map((puff) => (
        <div
          key={puff.x}
          style={{
            position: "absolute",
            left: puff.x * width,
            // Measured up from the baseline rather than down from the top, so
            // every ball rests on the same line whatever size it is.
            bottom: 0,
            width: puff.d * width,
            height: puff.d * width,
            borderRadius: "50%",
            background: "#FFFFFF",
          }}
        />
      ))}
    </div>
  );
}

export default function Clouds({ opacity = 1 }) {
  const mobile = useContext(MobileContext);
  // A phone shows the same sky at a third of the width, so full-size clouds
  // would each take half of it.
  const scale = mobile ? 0.55 : 1;
  const [clouds] = useState(makeClouds);

  return (
    <div
      aria-hidden="true"
      data-clouds=""
      style={{ position: "absolute", inset: 0, overflow: "hidden", opacity }}
    >
      <style>{`
        @keyframes utCloudDrift {
          from { transform: translateX(-30%); }
          to { transform: translateX(130%); }
        }
        .utCloudTrack {
          position: absolute;
          left: 0;
          width: 100%;
          animation: utCloudDrift linear infinite;
        }
        /* Paused rather than cancelled: a cancelled animation would put every
           cloud back on the left edge, whereas a paused one holds each where
           its own delay had already placed it. */
        @media (prefers-reduced-motion: reduce) {
          .utCloudTrack { animation-play-state: paused; }
        }
      `}</style>

      {clouds.map((cloud, index) => (
        <div
          key={index}
          className="utCloudTrack"
          style={{
            top: `${cloud.top}%`,
            opacity: cloud.opacity,
            animationDuration: `${cloud.seconds}s`,
            animationDelay: `${cloud.delay}s`,
          }}
        >
          <Cloud puffs={cloud.puffs} width={cloud.width * scale} />
        </div>
      ))}
    </div>
  );
}
