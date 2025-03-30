import React, { useEffect, useRef, useState } from "react";
import defaultColours from "../../../../themes/themes";

export default function Hexapod() {
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const simulationSpeedRef = useRef(100);

  const mouseShieldRadiusRef = useRef(100);
  const [, setRender] = useState(0); // Dummy state to force re-render

  let bodies = [];

  useEffect(() => {
    const canvas = canvasRef.current;
    let animationFrameId;
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const ctx = canvas.getContext("2d");

    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      mousePosRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    const handleMouseDown = () => {
      mouseClickRef.current = true;
    };

    const handleMouseUp = () => {
      mouseClickRef.current = false;
    };

    const originX = 0;
    const originY = 0;

    const sin30 = Math.sin((Math.PI / 180) * 30);
    const cos30 = Math.cos((Math.PI / 180) * 30);

    const convert3DtoIsometric = (position) => {
      return [
        originX + (position.x - position.y) * cos30,
        originY + (position.x + position.y) * sin30 - position.z,
      ];
    };

    const rotatePointZ = (point, angle) => {
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      return {
        x: point.x * cosA - point.y * sinA,
        y: point.x * sinA + point.y * cosA,
        z: point.z,
      };
    };

    // --- Basic Vector Math ---
    const vecAdd = (v1, v2) => ({
      x: v1.x + v2.x,
      y: v1.y + v2.y,
      z: v1.z + v2.z,
    });
    const vecSub = (v1, v2) => ({
      x: v1.x - v2.x,
      y: v1.y - v2.y,
      z: v1.z - v2.z,
    });
    const vecMag = (v) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    const vecScale = (v, s) => ({ x: v.x * s, y: v.y * s, z: v.z * s });

    // --- Constants ---
    const COXA_LENGTH = 25;
    const FEMUR_LENGTH = 35;
    const TIBIA_LENGTH = 90;
    const BODY_LENGTH = 130;
    const BODY_WIDTH = 100;
    const GROUND_LEVEL_Z = -80; // Where the feet ideally rest
    const BODY_HEIGHT_Z = -30 / 2; // From your body definition (z: -h2)

    // Sanity check for reachability
    const MAX_REACH = COXA_LENGTH + FEMUR_LENGTH + TIBIA_LENGTH;

    function clamp(value, min, max) {
      return Math.max(min, Math.min(value, max));
    }

    class Leg {
      // Store constants for potential use within the class
      static COXA_LENGTH = COXA_LENGTH;
      static FEMUR_LENGTH = FEMUR_LENGTH;
      static TIBIA_LENGTH = TIBIA_LENGTH;
      static MAX_REACH = MAX_REACH;

      /**
       * Creates a new Leg instance.
       * @param {Body} body - Reference to the parent Body object (must have position and angle properties).
       * @param {object} mountOffset - The mounting point relative to the body's center {x, y, z}.
       * @param {number} bodyAngleOffset - The base horizontal angle (radians) relative to the body's forward direction.
       */
      constructor(body, mountOffset, bodyAngleOffset) {
        if (
          !body ||
          typeof body.position === "undefined" ||
          typeof body.angle === "undefined"
        ) {
          throw new Error(
            "Leg constructor requires a valid Body object with 'position' and 'angle'."
          );
        }
        this.body = body;
        this.mountOffset = mountOffset;
        this.bodyAngleOffset = bodyAngleOffset;

        // --- Current State Angles (radians) ---
        this.coxaAngle = 0; // Relative to bodyAngleOffset in XY plane
        this.femurAngle = 0; // Relative to horizontal plane (positive = up)
        this.tibiaAngle = 0; // Relative to femur direction (0 = straight, negative = knee bend up/back)

        // --- Calculated Joint Positions (World Space) ---
        // Stored as {x, y, z} objects
        this.jointPositions = [
          { x: 0, y: 0, z: 0 }, // 0: World Mount Point
          { x: 0, y: 0, z: 0 }, // 1: Coxa End / Femur Start
          { x: 0, y: 0, z: 0 }, // 2: Femur End / Tibia Start
          { x: 0, y: 0, z: 0 }, // 3: Tibia End / Foot Tip
        ];

        // Calculate initial positions based on default angles
        this.calculateFK();
      }

      updateJointPositions(pos) {
        this.jointPositions[0] = {
          x: pos.x + this.mountOffset.x,
          y: pos.y + this.mountOffset.y,
          z: pos.z + this.mountOffset.z,
        };
      }

      updateBodyAngle(angle) {
        this.bodyAngleOffset = angle;
      }

      // --- Forward Kinematics (FK) ---
      /**
       * Calculates the world positions of all leg joints based on the current
       * body state and leg angles. Updates this.jointPositions.
       */
      calculateFK() {
        const bodyPos = this.body.position;
        const bodyAngle = this.body.angle; // Body's rotation around its Z-axis

        // 1. Calculate World Mount Point
        // Rotate the body-relative mount offset by the body's angle
        const rotatedMountX =
          this.mountOffset.x * Math.cos(bodyAngle) -
          this.mountOffset.y * Math.sin(bodyAngle);
        const rotatedMountY =
          this.mountOffset.x * Math.sin(bodyAngle) +
          this.mountOffset.y * Math.cos(bodyAngle);
        // Add the body's world position
        const worldMountX = bodyPos.x + rotatedMountX;
        const worldMountY = bodyPos.y + rotatedMountY;
        const worldMountZ = bodyPos.z + this.mountOffset.z; // Assume mount Z offset is relative to body Z
        this.jointPositions[0] = {
          x: worldMountX,
          y: worldMountY,
          z: worldMountZ,
        };

        // 2. Calculate Coxa End Point
        // Combine body angle, leg's base offset, and current coxa angle
        const totalCoxaAngle =
          bodyAngle + this.bodyAngleOffset + this.coxaAngle;
        const coxaEndX =
          worldMountX + Leg.COXA_LENGTH * Math.cos(totalCoxaAngle);
        const coxaEndY =
          worldMountY + Leg.COXA_LENGTH * Math.sin(totalCoxaAngle);
        const coxaEndZ = worldMountZ; // Assume coxa segment is purely horizontal
        this.jointPositions[1] = { x: coxaEndX, y: coxaEndY, z: coxaEndZ };

        // 3. Calculate Femur End Point
        // Femur rotates in the vertical plane defined by the coxa direction
        const coxaDirX = Math.cos(totalCoxaAngle); // Unit vector in coxa's direction (XY plane)
        const coxaDirY = Math.sin(totalCoxaAngle);
        // Components of the femur in the vertical plane (relative to horizontal)
        const femurHoriz = Leg.FEMUR_LENGTH * Math.cos(this.femurAngle);
        const femurVert = Leg.FEMUR_LENGTH * Math.sin(this.femurAngle); // Positive angle = up

        const femurEndX = coxaEndX + femurHoriz * coxaDirX; // Add horizontal component along coxa direction
        const femurEndY = coxaEndY + femurHoriz * coxaDirY;
        const femurEndZ = coxaEndZ + femurVert; // Add vertical component
        this.jointPositions[2] = { x: femurEndX, y: femurEndY, z: femurEndZ };

        // 4. Calculate Tibia End Point (Foot Tip)
        // Tibia angle is relative to femur. Calculate total angle in vertical plane.
        const totalTibiaAngleVertical = this.femurAngle + this.tibiaAngle;
        // Components of the tibia in the vertical plane (relative to horizontal)
        const tibiaHoriz = Leg.TIBIA_LENGTH * Math.cos(totalTibiaAngleVertical);
        const tibiaVert = Leg.TIBIA_LENGTH * Math.sin(totalTibiaAngleVertical);

        const tibiaEndX = femurEndX + tibiaHoriz * coxaDirX; // Add horizontal component along coxa direction
        const tibiaEndY = femurEndY + tibiaHoriz * coxaDirY;
        const tibiaEndZ = femurEndZ + tibiaVert; // Add vertical component
        this.jointPositions[3] = { x: tibiaEndX, y: tibiaEndY, z: tibiaEndZ };
      }

      setAngles(angle1, angle2, angle3) {
        this.coxaAngle = angle1;
        this.femurAngle = angle2;
        this.tibiaAngle = angle3;
      }

      // --- Inverse Kinematics (IK) ---
      /**
       * Calculates the required leg angles (coxa, femur, tibia) to reach a target
       * position in world space. Updates the leg's internal angles if reachable.
       * @param {object} targetWorldPos - The desired {x, y, z} position for the foot tip.
       * @returns {boolean} - True if the target is reachable and angles were updated, false otherwise.
       */
      solveIK(targetWorldPos) {
        const bodyPos = this.body.position;
        const bodyAngle = this.body.angle;

        // 1. Calculate World Mount Point (redundant, could use this.jointPositions[0] if FK is up-to-date)
        const rotatedMountX =
          this.mountOffset.x * Math.cos(bodyAngle) -
          this.mountOffset.y * Math.sin(bodyAngle);
        const rotatedMountY =
          this.mountOffset.x * Math.sin(bodyAngle) +
          this.mountOffset.y * Math.cos(bodyAngle);
        const worldMountX = bodyPos.x + rotatedMountX;
        const worldMountY = bodyPos.y + rotatedMountY;
        const worldMountZ = bodyPos.z + this.mountOffset.z;
        const worldMountPoint = {
          x: worldMountX,
          y: worldMountY,
          z: worldMountZ,
        };

        // 2. Calculate Target Vector relative to World Mount Point
        const targetVectorWorld = {
          x: targetWorldPos.x - worldMountPoint.x,
          y: targetWorldPos.y - worldMountPoint.y,
          z: targetWorldPos.z - worldMountPoint.z,
        };

        // 3. Transform Target Vector into Leg's Base Coordinate System (Undo Body Rotation + Offset)
        // Angle to rotate target vector *back* to align with leg's base X-axis
        const inverseBaseAngle = -(bodyAngle + this.bodyAngleOffset);
        const cosInv = Math.cos(inverseBaseAngle);
        const sinInv = Math.sin(inverseBaseAngle);

        // Target coordinates relative to mount point, as seen from leg's base orientation
        const targetLegX =
          targetVectorWorld.x * cosInv - targetVectorWorld.y * sinInv;
        const targetLegY =
          targetVectorWorld.x * sinInv + targetVectorWorld.y * cosInv;
        const targetLegZ = targetVectorWorld.z; // Z is unchanged by XY rotation

        // 4. Calculate Coxa Angle
        // Angle needed in XY plane to point the coxa towards the target's XY projection
        const newCoxaAngle = Math.atan2(targetLegY, targetLegX);

        // 5. Prepare for 2D IK in the Leg's Vertical Plane
        // Target coordinates relative to the *Coxa End Joint*
        const horizontalDist = Math.sqrt(
          targetLegX * targetLegX + targetLegY * targetLegY
        );
        // D_x: Horizontal distance in the vertical plane (along coxa direction) from coxa joint to target
        const D_x = horizontalDist - Leg.COXA_LENGTH;
        // D_z: Vertical distance from coxa joint to target
        const D_z = targetLegZ; // Z relative to coxa joint (assumed at same Z as mount)

        // 6. Perform 2D IK for Femur and Tibia
        const L1 = Leg.FEMUR_LENGTH;
        const L2 = Leg.TIBIA_LENGTH;
        const distSq = D_x * D_x + D_z * D_z; // Squared distance from coxa joint to target
        const dist = Math.sqrt(distSq);

        // --- Reachability Check ---
        const epsilon = 1e-4; // Tolerance for float comparisons
        if (
          dist > L1 + L2 + epsilon ||
          dist < Math.abs(L1 - L2) - epsilon ||
          horizontalDist > Leg.COXA_LENGTH + L1 + L2 + epsilon
        ) {
          // console.warn(`IK: Target unreachable. Dist: ${dist.toFixed(2)}, HorizDist: ${horizontalDist.toFixed(2)}`);
          return false; // Target is out of reach
        }

        // --- Calculate Angles using Law of Cosines ---
        // Angle alpha2: Angle at the knee joint (between femur and tibia)
        // Clamping needed due to potential floating point inaccuracies
        const cosAlpha2 = clamp(
          (distSq - L1 * L1 - L2 * L2) / (2 * L1 * L2),
          -1,
          1
        );
        const alpha2 = Math.acos(cosAlpha2); // Angle between L1 and L2 extended straight (0 to PI)

        // Angle alpha1: Angle at the hip joint (between femur L1 and the direct line 'dist')
        const cosAlpha1 = clamp(
          (distSq + L1 * L1 - L2 * L2) / (2 * dist * L1),
          -1,
          1
        );
        let alpha1 = Math.acos(cosAlpha1);

        // Angle beta: Angle of the direct line from coxa joint to target in the vertical plane
        const beta = Math.atan2(D_z, D_x);

        // --- Determine Femur and Tibia Angles based on Configuration (Elbow/Knee Up) ---
        // For knee up, the femur angle relative to horizontal (beta) is reduced by alpha1
        const newFemurAngle = beta - alpha1; // Angle relative to horizontal (positive = up)

        // Tibia angle relative to femur. alpha2 is angle between segments.
        // If alpha2 is PI (straight), tibiaAngle should be 0.
        // If alpha2 is < PI (bent), tibiaAngle should be negative for knee up.
        const newTibiaAngle = -(Math.PI - alpha2); // Angle relative to femur

        // 7. Update Internal Angles
        this.coxaAngle = newCoxaAngle;
        this.femurAngle = newFemurAngle;
        this.tibiaAngle = newTibiaAngle;

        return true; // Solution found and angles updated
      }

      // --- Drawing ---
      /**
       * Draws the leg segments on the provided canvas context.
       * Assumes calculateFK() has been called recently to update jointPositions.
       * @param {CanvasRenderingContext2D} ctx - The drawing context.
       * @param {function} convert3DtoIsometric - The projection function {x,y,z} -> [screenX, screenY].
       */
      draw(ctx, convert3DtoIsometric) {
        if (!this.jointPositions || this.jointPositions.length < 4) return;

        ctx.beginPath();
        // Use a distinct color for legs, maybe slightly transparent
        ctx.strokeStyle = defaultColours.secondaryAccent; // Dark grey, slightly transparent
        ctx.lineWidth = 3; // Make legs reasonably thick

        // Project all points first
        const screenPoints = this.jointPositions.map((p) =>
          convert3DtoIsometric(p)
        );

        // Draw segments connecting the projected points
        ctx.moveTo(screenPoints[0][0], screenPoints[0][1]); // Mount
        ctx.lineTo(screenPoints[1][0], screenPoints[1][1]); // Coxa -> Femur
        ctx.lineTo(screenPoints[2][0], screenPoints[2][1]); // Femur -> Tibia
        ctx.lineTo(screenPoints[3][0], screenPoints[3][1]); // Tibia -> Foot Tip

        ctx.stroke();

        // Optional: Draw small circles at joints for debugging/visualization
        // ctx.fillStyle = 'red';
        // screenPoints.forEach((p, index) => {
        //     ctx.beginPath();
        //     ctx.arc(p[0], p[1], index === 3 ? 4 : 2, 0, 2 * Math.PI); // Foot tip slightly larger
        //     ctx.fill();
        // });
      }

      // --- Utility ---
      /**
       * Gets the current world position of the foot tip.
       * Assumes calculateFK() has been called recently.
       * @returns {object} {x, y, z} position of the foot tip.
       */
      getFootTipPosition() {
        // Ensure FK is up to date if necessary, or rely on external call
        // this.calculateFK();
        return this.jointPositions[3];
      }
    }

    class Body {
      constructor(x, y, z) {
        this.position = { x: x, y: y, z: z };
        this.angle = 0;
        this.localPoints = this.defineLocalPoints();
        this.worldPoints = [];
        this.recalculateWorldPoints();
      }

      defineLocalPoints() {
        return [
          { x: BODY_LENGTH / 2, y: BODY_WIDTH / 2, z: 0 },
          { x: 0, y: (1.2 * BODY_WIDTH) / 2, z: 0 },
          { x: -BODY_LENGTH / 2, y: BODY_WIDTH / 2, z: 0 },
          { x: -BODY_LENGTH / 2, y: -BODY_WIDTH / 2, z: 0 },
          { x: 0, y: -(1.2 * BODY_WIDTH) / 2, z: 0 },
          { x: BODY_LENGTH / 2, y: -BODY_WIDTH / 2, z: 0 },
          { x: BODY_LENGTH / 2, y: BODY_WIDTH / 2, z: 0 }, // Close the shape
        ];
      }

      recalculateWorldPoints() {
        this.worldPoints = this.localPoints.map((localPoint) => {
          const rotatedLocalPoint = rotatePointZ(localPoint, this.angle);

          return {
            x: rotatedLocalPoint.x + this.position.x,
            y: rotatedLocalPoint.y + this.position.y,
            z: rotatedLocalPoint.z + this.position.z,
          };
        });
      }

      draw() {
        if (this.worldPoints.length === 0) return;

        const initialScreenPos = convert3DtoIsometric(this.worldPoints[0]);
        ctx.moveTo(initialScreenPos[0], initialScreenPos[1]);
        ctx.beginPath();
        this.worldPoints.forEach((point) => {
          const screenPos = convert3DtoIsometric(point);
          ctx.lineTo(screenPos[0], screenPos[1]);
        });
        ctx.strokeStyle = defaultColours.accent;
        ctx.stroke();
      }

      calculateTargetWorldAngle() {
        const centerScreenPos = convert3DtoIsometric(this.position); // [screenX, screenY]

        const targetScreenVec = {
          x: mousePosRef.current.x - centerScreenPos[0],
          y: mousePosRef.current.y - centerScreenPos[1],
        };

        if (
          Math.abs(targetScreenVec.x) < 1e-3 &&
          Math.abs(targetScreenVec.y) < 1e-3
        ) {
          return this.angle;
        }

        const worldXPoint = {
          x: this.position.x + 1,
          y: this.position.y,
          z: this.position.z,
        };
        const worldYPoint = {
          x: this.position.x,
          y: this.position.y + 1,
          z: this.position.z,
        };
        const screenXPoint = convert3DtoIsometric(worldXPoint);
        const screenYPoint = convert3DtoIsometric(worldYPoint);

        const screenWorldXVec = {
          x: screenXPoint[0] - centerScreenPos[0],
          y: screenXPoint[1] - centerScreenPos[1],
        };
        const screenWorldYVec = {
          x: screenYPoint[0] - centerScreenPos[0],
          y: screenYPoint[1] - centerScreenPos[1],
        };

        const a = screenWorldXVec.x;
        const b = screenWorldYVec.x;
        const c = targetScreenVec.x;
        const d = screenWorldXVec.y;
        const e = screenWorldYVec.y;
        const f = targetScreenVec.y;

        const det = a * e - b * d;

        let worldX, worldY;

        if (Math.abs(det) < 1e-6) {
          console.warn(
            "Isometric projection axes are collinear on screen. Cannot reliably determine angle."
          );
          return this.angle;
        } else {
          worldX = (c * e - b * f) / det;
          worldY = (a * f - c * d) / det;
        }

        const targetWorldAngle = Math.atan2(worldY, worldX);
        return targetWorldAngle;
      }

      update() {
        this.angle = this.calculateTargetWorldAngle();
        this.position.x += 1 * Math.cos(this.angle);
        this.position.y += 1 * Math.sin(this.angle);

        this.recalculateWorldPoints();
      }
    }

    const legMountOffsets = [
      { x: BODY_LENGTH * 0.4, y: BODY_WIDTH * 0.5, z: 0 }, // Front Right
      { x: 0, y: BODY_WIDTH * 0.6, z: 0 }, // Mid Right
      { x: -BODY_LENGTH * 0.4, y: BODY_WIDTH * 0.5, z: 0 }, // Rear Right
      { x: -BODY_LENGTH * 0.4, y: -BODY_WIDTH * 0.5, z: 0 }, // Rear Left
      { x: 0, y: -BODY_WIDTH * 0.6, z: 0 }, // Mid Left
      { x: BODY_LENGTH * 0.4, y: -BODY_WIDTH * 0.5, z: 0 }, // Front Left
    ];

    const legAngleOffsets = [
      // Angle relative to body's +X axis (forward)
      -Math.PI / 3, // Front Right (-60 deg)
      0, // Mid Right
      Math.PI / 3, // Rear Right (60 deg)
      (2 * Math.PI) / 3, // Rear Left (120 deg)
      Math.PI, // Mid Left (180 deg)
      (-2 * Math.PI) / 3, // Front Left (-120 deg)
    ];

    const legs = [];

    let gaitCycle = 0;

    function animate() {
      if (bodies.length > 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // hahah dont worry about it
        legs.forEach((leg, index) => {
          let angle1;
          if (index === 1 || index === 2 || index === 0) {
            angle1 =
              gaitCycle < 180
                ? (Math.PI * (45 + gaitCycle / 2)) / 180
                : (Math.PI * (45 - (gaitCycle + 360) / 2)) / 180;
          } else if (index === 3) {
            angle1 =
              gaitCycle > 180
                ? (Math.PI * (-45 + gaitCycle / 2)) / 180
                : (Math.PI * (-45 - (gaitCycle + 360) / 2)) / 180;
          } else if (index === 4) {
            angle1 =
              gaitCycle > 180
                ? (Math.PI * (315 + gaitCycle / 2)) / 180
                : (Math.PI * (315 - (gaitCycle + 360) / 2)) / 180;
          } else {
            angle1 =
              gaitCycle > 180
                ? (Math.PI * (315 + gaitCycle / 2)) / 180
                : (Math.PI * (315 - (gaitCycle + 360) / 2)) / 180;
          }

          const angle2 = (Math.PI * 40) / 180;
          const angle3 = (Math.PI * -100) / 180;

          leg.setAngles(angle1, angle2, angle3);

          leg.calculateFK();
        });

        bodies[0].update();
        bodies[0].draw();
        legs.forEach((leg) => {
          leg.draw(ctx, convert3DtoIsometric);
        });

        gaitCycle += 1;
        gaitCycle %= 360;

        animationFrameId = requestAnimationFrame(animate);
      }
    }

    const init = () => {
      if (bodies.length === 0) {
        bodies.push(new Body(500, 100, 0));
      }
      if (typeof bodies[0] !== "undefined") {
        // Check if body exists before creating legs
        for (let i = 0; i < 6; i++) {
          legs.push(new Leg(bodies[0], legMountOffsets[i], legAngleOffsets[i]));
        }
      }
    };

    init();
    animate();

    window.addEventListener("pointermove", handleMouseMove);
    window.addEventListener("touchmove", handleMouseMove);
    window.addEventListener("pointerdown", handleMouseDown);
    window.addEventListener("pointerup", handleMouseUp);

    return () => {
      cancelAnimationFrame(animationFrameId);
      bodies = [];

      window.removeEventListener("pointermove", handleMouseMove);
      window.removeEventListener("touchmove", handleMouseMove);
      window.removeEventListener("pointerdown", handleMouseDown);
      window.removeEventListener("pointerup", handleMouseUp);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
        }}
      />
      <div style={{ zIndex: 10 }}>
        <div style={{ position: "absolute", top: "1em", left: "1em" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "0.5em",
            }}
          >
            Simulation Speed:
            <input
              type="range"
              min="1.0"
              max="200.0"
              value={simulationSpeedRef.current}
              onChange={(e) => {
                simulationSpeedRef.current = Number(e.target.value);
                setRender((prev) => prev + 1); // Force re-render to update slider UI
              }}
              style={{ marginLeft: "0.5em" }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
