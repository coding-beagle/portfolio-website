import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { IconGroup } from "../utilities/popovers";
import { ChangerGroup, CHANGER_TYPE } from "../utilities/valueChangers";
import { ElementCollisionHitbox } from "../utilities/usefulFunctions";
import { SoftBodyWorld } from "../utilities/softBody";
import {
  useCanvasScene,
  SceneCanvas,
  createPointerTracker,
  clearCanvas,
} from "../utilities/engine";

export default function SquishBall({ visibleUI }) {
  const { theme } = useTheme();
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const ballSizeRef = useRef(80);
  const areaRef = useRef(0);
  const touchActiveRef = useRef(false);
  const ballCountRef = useRef(3);
  const simulationSpeedRef = useRef(100);
  const mouseShieldRadiusRef = useRef(100);
  const showControlPointsRef = useRef(false);

  const squishFactorRef = useRef(1);
  const desiredAreaRef = useRef(50);

  const visibleUIRef = useRef(visibleUI);
  const [, setRender] = useState(0); // Dummy state to force re-render

  const canvasRef = useCanvasScene(({ canvas, ctx, onCleanup }) => {
    const titleHitbox = new ElementCollisionHitbox("title", 20);
    const collisionHitboxes = [titleHitbox];

    const recalculateRect = () => {
      collisionHitboxes.forEach((hitbox) => hitbox.recalculate());
    };
    recalculateRect();

    onCleanup(
      createPointerTracker(canvas, {
        posRef: mousePosRef,
        downRef: mouseClickRef,
        touchActiveRef,
      })
    );

    const world = new SoftBodyWorld({
      canvas,
      hitboxes: collisionHitboxes,
      pointer: {
        posRef: mousePosRef,
        downRef: mouseClickRef,
        touchActiveRef,
      },
      ballSize: ballSizeRef,
      ballPressure: desiredAreaRef,
      squishFactor: squishFactorRef,
      simulationSpeed: simulationSpeedRef,
      grabRadius: mouseShieldRadiusRef,
      // The title is only there to be collided with while it is on screen.
      collisionsEnabled: visibleUIRef,
    });
    world.syncBodyCount(ballCountRef);

    return {
      onResize: recalculateRect,
      frame: () => {
        clearCanvas(ctx, canvas);

        // The title only pushes back while it is actually on screen.
        collisionHitboxes.forEach((hitbox) => {
          if (visibleUIRef.current && !hitbox.elementObject) {
            hitbox.tryUpdateElement(hitbox.elementName);
          } else if (!visibleUIRef.current) {
            hitbox.elementObject = null;
          }
          hitbox.recalculate();
        });

        world.syncBodyCount(ballCountRef);
        world.step();
        world.draw(ctx, {
          fill: theme.secondary,
          accent: theme.accent,
          showControlPoints: showControlPointsRef.current,
        });

        areaRef.current = world.area;
      },
      cleanup: () => world.clear(),
    };
  }, [theme.secondary, theme.accent]);

  useEffect(() => {
    visibleUIRef.current = visibleUI;
  }, [visibleUI]);

  return (
    <>
      <SceneCanvas ref={canvasRef} />
      {visibleUI && (
        <div style={{ zIndex: 3000 }}>
          <ChangerGroup
            valueArrays={[
              {
                title: "Ball Count:",
                valueRef: ballCountRef,
                minValue: "1",
                maxValue: "12",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Ball Size:",
                valueRef: ballSizeRef,
                minValue: "20",
                maxValue: "150",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Simulation Speed:",
                valueRef: simulationSpeedRef,
                minValue: "1",
                maxValue: "200.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                title: "Ball pressure",
                valueRef: desiredAreaRef,
                minValue: "1.0",
                maxValue: "100.0",
                type: CHANGER_TYPE.SLIDER,
              },
              {
                type: CHANGER_TYPE.BUTTON,
                title: "",
                buttonText: showControlPointsRef.current
                  ? "Hide control points"
                  : "Show control points",
                callback: () => {
                  showControlPointsRef.current = !showControlPointsRef.current;
                  setRender((r) => r + 1);
                },
              },
            ]}
            rerenderSetter={setRender}
          />

          <IconGroup icons={[{ type: "MOUSE" }]} />
        </div>
      )}
    </>
  );
}
