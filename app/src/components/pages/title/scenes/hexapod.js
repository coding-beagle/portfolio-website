import React, { useEffect, useRef, useState } from "react";
import defaultColours from "../../../../themes/themes";

export default function Hexapod() {
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const simulationSpeedRef = useRef(100);
  const gaitCountRef = useRef(180);

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

    // --- Constants ---
    const COXA_LENGTH = 25;
    const FEMUR_LENGTH = 35;
    const TIBIA_LENGTH = 90;
    const BODY_LENGTH = 200;
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

        this.nextPositions = [];
        this.nextPosIndex = 0;

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
        // 1. targetWorldPos is assumed to be the target position relative
        //    to the leg's mounting point on the robot's body.

        // 2. Create a working copy of the target vector relative to the mount point.
        const targetVectorWorld = {
          x: targetWorldPos.x,
          y: targetWorldPos.y,
          z: targetWorldPos.z,
        };

        // 3. Transform Target Vector into the Leg's Base Coordinate System.
        // The leg's base frame (where coxa angle 0 points along its X-axis)
        // is rotated by 'this.bodyAngleOffset' around Z relative to the body/world frame.
        // To get the target's coordinates *in the leg's frame*, we need to rotate
        // the targetVectorWorld by the *negative* of this angle.
        // Rotation matrix for angle -theta around Z:
        // | cos(-theta)  -sin(-theta)  0 |   | cos(theta)   sin(theta)  0 |
        // | sin(-theta)   cos(-theta)  0 | = |-sin(theta)   cos(theta)  0 |
        // |      0            0       1 |   |      0            0       1 |
        // x_leg = x_world * cos(offset) + y_world * sin(offset)
        // y_leg = x_world * -sin(offset) + y_world * cos(offset)
        // z_leg = z_world

        const cosOffset = Math.cos(this.bodyAngleOffset);
        const sinOffset = Math.sin(this.bodyAngleOffset);

        const targetLegX =
          targetVectorWorld.x * cosOffset + targetVectorWorld.y * sinOffset;
        const targetLegY =
          -targetVectorWorld.x * sinOffset + targetVectorWorld.y * cosOffset;
        const targetLegZ = targetVectorWorld.z; // Z remains unchanged by rotation around Z

        // --- Now proceed with IK using coordinates in the leg's frame ---

        // 4. Calculate Coxa Angle
        // This is the angle in the leg's XY plane needed to point the coxa
        // towards the target's projection in that plane.
        const newCoxaAngle = Math.atan2(targetLegY, targetLegX);

        // 5. Prepare for 2D IK in the Leg's Vertical Plane
        // This plane is now aligned with the rotated coxa.
        // Calculate target coordinates relative to the *Coxa End Joint* (where the femur connects).

        // horizontalDist is the length of the projection in the leg's XY plane.
        const horizontalDist = Math.sqrt(
          targetLegX * targetLegX + targetLegY * targetLegY
        );

        // D_x: Horizontal distance *in the vertical plane along the coxa's direction*
        //      from the femur joint (coxa end) to the target.
        const D_x = horizontalDist - Leg.COXA_LENGTH;

        // D_z: Vertical distance from the femur joint (coxa end) to the target.
        //      We assume the coxa joint is at the same Z level as the mount point.
        const D_z = targetLegZ;

        // 6. Perform 2D IK for Femur and Tibia using D_x and D_z
        const L1 = Leg.FEMUR_LENGTH; // Femur length
        const L2 = Leg.TIBIA_LENGTH; // Tibia length
        const distSq = D_x * D_x + D_z * D_z; // Squared distance from femur joint to target
        const dist = Math.sqrt(distSq); // Direct distance from femur joint to target

        // --- Reachability Check ---
        const epsilon = 1e-4; // Tolerance for floating point comparisons
        // Check if target is too far (straightened leg) or too close (folded leg)
        // or if the horizontal distance requires stretching beyond max reach.
        if (
          dist > L1 + L2 + epsilon || // Too far generally
          dist < Math.abs(L1 - L2) - epsilon || // Too close generally (based on segment difference)
          horizontalDist < Leg.COXA_LENGTH - (L1 + L2) - epsilon || // Cannot reach horizontally behind coxa base much
          horizontalDist > Leg.COXA_LENGTH + L1 + L2 + epsilon // Cannot reach horizontally beyond max extension
        ) {
          // console.warn(`IK: Target unreachable. Dist: ${dist.toFixed(2)}, HorizDist: ${horizontalDist.toFixed(2)}`);
          return false; // Target is out of reach
        }

        // --- Calculate Angles using Law of Cosines ---
        // Find angles within the triangle formed by Femur(L1), Tibia(L2), and the direct distance (dist)

        // Angle alpha2: Angle at the knee joint (between femur and tibia). Using Law of Cosines on side 'dist'.
        // Clamp the argument due to potential floating point inaccuracies near -1 or 1.
        const cosAlpha2 = clamp(
          (distSq - L1 * L1 - L2 * L2) / (2 * L1 * L2),
          -1,
          1
        );
        const alpha2 = Math.acos(cosAlpha2); // Angle between L1 and L2 segments (0 to PI)

        // Angle alpha1: Angle at the hip joint (between femur L1 and the direct line 'dist'). Using Law of Cosines on side L2.
        const cosAlpha1 = clamp(
          (distSq + L1 * L1 - L2 * L2) / (2 * dist * L1),
          -1,
          1
        );
        let alpha1 = Math.acos(cosAlpha1); // Angle between L1 and 'dist' line (0 to PI)

        // Angle beta: Angle of the direct line 'dist' from the femur joint to the target, relative to the horizontal plane (along coxa direction).
        const beta = Math.atan2(D_z, D_x);

        // --- Determine Femur and Tibia Angles based on Configuration (assuming standard 'knee up/forward') ---

        // newFemurAngle: Angle of the femur relative to the horizontal plane (along coxa direction).
        // Positive angle means femur points upwards.
        // It's the angle of the direct line (beta) minus the internal angle alpha1.
        const newFemurAngle = beta - alpha1;

        // newTibiaAngle: Angle of the tibia relative *to the femur*.
        // If the leg were straight (alpha2 = PI), tibia angle would be 0 relative to femur.
        // Since alpha2 is the angle *between* the segments (0 to PI), the servo angle
        // for a standard knee configuration is typically defined such that straight is PI,
        // and bending decreases the angle. Or, relative to femur, straight is 0.
        // Here, alpha2 = PI means straight. We want the angle relative to the femur.
        // For knee up/forward, a bend (alpha2 < PI) means a negative angle relative to the femur extension.
        const newTibiaAngle = -(Math.PI - alpha2); // Relative angle: 0 when straight, negative when bent 'up'.

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
      draw() {
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
        this.targetAngle = 0;
        this.localPoints = this.defineLocalPoints();
        this.worldPoints = [];
        this.isMoving = true;
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
        // console.log("Angle diff: ", Math.abs(this.angle - this.targetAngle));
        // if (Math.abs(this.angle - this.targetAngle) > 0.1) {
        //   this.angle += Math.sign(this.angle - this.targetAngle) * -0.01;
        // }
        this.angle = this.calculateTargetWorldAngle();
        // this.angle %= Math.PI * 2;

        const screenPosApprox = convert3DtoIsometric(this.worldPoints[0]);

        const dxMouse = mousePosRef.current.x - screenPosApprox[0];
        const dyMouse = mousePosRef.current.y - screenPosApprox[1];
        const distanceFromMouse = Math.sqrt(dxMouse ** 2 + dyMouse ** 2);
        if (distanceFromMouse > 100) {
          this.isMoving = true;
          this.position.x +=
            ((1 * gaitCountRef.current) / 45) * Math.cos(this.angle);
          this.position.y +=
            ((1 * gaitCountRef.current) / 45) * Math.sin(this.angle);
        } else {
          this.isMoving = false;
        }

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

    gaitCountRef.current = 180;

    let gaitCycle = 0;
    let gaitCycle2 = gaitCountRef.current / 2;

    function binomialCoefficient(n, k) {
      if (k < 0 || k > n) {
        return 0; // Invalid input
      }
      if (k === 0 || k === n) {
        return 1; // Base cases
      }
      // Take advantage of symmetry C(n, k) == C(n, n-k)
      if (k > n / 2) {
        k = n - k;
      }
      let res = 1;
      for (let i = 1; i <= k; ++i) {
        // Calculate (n - i + 1) / i iteratively
        res = (res * (n - i + 1)) / i;
      }
      return res;
    }

    /**
     * Calculates a point on a Bézier curve defined by the given control points
     * for a specific parameter t (0 <= t <= 1).
     * Uses the general Bézier curve formula (Bernstein polynomials).
     * @param {Array<Object>} controlPoints - An array of control point objects {x, y, z}.
     * @param {number} t - The parameter value, ranging from 0 to 1.
     * @returns {Object} The calculated point {x, y, z} on the curve for parameter t.
     */
    function getPointOnBezierCurve(controlPoints, t) {
      const n = controlPoints.length - 1; // Degree of the curve
      let x = 0;
      let y = 0;
      let z = 0;

      if (t < 0 || t > 1) {
        console.warn("Parameter t should be between 0 and 1. Clamping.");
        t = Math.max(0, Math.min(1, t));
      }

      for (let i = 0; i <= n; i++) {
        const bernsteinCoefficient =
          binomialCoefficient(n, i) * Math.pow(t, i) * Math.pow(1 - t, n - i);
        x += controlPoints[i].x * bernsteinCoefficient;
        y += controlPoints[i].y * bernsteinCoefficient;
        z += controlPoints[i].z * bernsteinCoefficient;
      }

      return { x, y, z };
    }

    /**
     * Creates an array of points representing a Bézier curve defined by a set of 3D control points.
     *
     * @param {Array<Object>} controlPoints - An array of control point objects, where each object
     * has 'x', 'y', and 'z' properties (e.g., {x: 1, y: 2, z: 3}).
     * Must contain at least 2 points.
     * @param {number} resolution - The number of line segments to approximate the curve.
     * A higher number results in a smoother curve. Must be >= 1.
     * The function will return (resolution + 1) points.
     * @returns {Array<Object> | null} An array of point objects {x, y, z} lying on the Bézier curve,
     * including the start and end points, or null if inputs are invalid.
     */
    function createBezierCurvePoints(controlPoints, resolution) {
      // --- Input Validation ---
      if (!Array.isArray(controlPoints) || controlPoints.length < 2) {
        console.error(
          "Error: controlPoints must be an array with at least 2 points."
        );
        return null;
      }
      if (
        typeof resolution !== "number" ||
        !Number.isInteger(resolution) ||
        resolution < 1
      ) {
        console.error(
          "Error: resolution must be an integer greater than or equal to 1."
        );
        return null;
      }
      // Optional: Check if points have x, y, z properties (can be more robust)
      for (const p of controlPoints) {
        if (
          typeof p?.x !== "number" ||
          typeof p?.y !== "number" ||
          typeof p?.z !== "number"
        ) {
          console.error(
            "Error: Each control point must be an object with numeric x, y, and z properties."
          );
          return null;
        }
      }

      // --- Calculation ---
      const curvePoints = [];
      const numPointsToCalculate = resolution + 1;

      for (let i = 0; i < numPointsToCalculate; i++) {
        // Calculate parameter t (from 0 to 1)
        const t = i / resolution;
        // Calculate the point on the curve for this t
        const pointOnCurve = getPointOnBezierCurve(controlPoints, t);
        curvePoints.push(pointOnCurve);
      }

      // Ensure the very last point is exactly the last control point
      // (due to potential floating point inaccuracies)
      if (resolution > 0) {
        curvePoints[curvePoints.length - 1] = {
          ...controlPoints[controlPoints.length - 1],
        }; // Make a copy
      } else {
        // resolution === 1 means only start/end needed
        curvePoints[0] = { ...controlPoints[0] };
        curvePoints[1] = { ...controlPoints[controlPoints.length - 1] };
      }

      return curvePoints;
    }

    const controlPoints = [
      { x: 2, y: 5, z: 90 },
      { x: 0, y: 5, z: 90 },
      { x: -2, y: 5, z: 90 },
      { x: -2, y: 5, z: 120 },
      { x: 2, y: 5, z: 120 },
      { x: 2, y: 5, z: 90 },
    ];

    const controlPoints2 = [
      { x: 2, y: -5, z: 90 },
      { x: 0, y: -5, z: 90 },
      { x: -2, y: -5, z: 90 },
      { x: -2, y: -5, z: 120 },
      { x: 2, y: -5, z: 120 },
      { x: 2, y: -5, z: 90 },
    ];

    const standingPointRight = { x: 0, y: -5, z: 90 };
    const standingPointLeft = { x: 0, y: 5, z: 90 };

    let interpCounter;
    let walkingPointsLeft, walkingPointsRight;
    const regenWalkCycle = () => {
      walkingPointsRight = createBezierCurvePoints(
        controlPoints,
        360 - gaitCountRef.current - 1
      );
      walkingPointsLeft = createBezierCurvePoints(
        controlPoints2,
        360 - gaitCountRef.current - 1
      );
    };

    regenWalkCycle();

    let lastGaitCount = 0;
    function animate() {
      if (bodies.length > 0) {
        if (lastGaitCount !== gaitCountRef.current) {
          regenWalkCycle();
          gaitCycle = 0;
          gaitCycle2 = Math.ceil((360 - gaitCountRef.current) / 2);
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        legs.forEach((leg, index) => {
          if (leg.body.isMoving) {
            if ([0, 1, 2].includes(index)) {
              if ([1].includes(index)) {
                leg.solveIK(walkingPointsRight[gaitCycle2]);
              } else {
                leg.solveIK(walkingPointsRight[gaitCycle]);
              }
            } else {
              if ([3, 5].includes(index)) {
                leg.solveIK(walkingPointsLeft[gaitCycle2]);
              } else {
                leg.solveIK(walkingPointsLeft[gaitCycle]);
              }
            }
          } else {
            const legPos = leg.getFootTipPosition();
            let standingPoint;
            if ([0, 1, 2].includes(index)) {
              standingPoint = standingPointLeft;
            } else {
              standingPoint = standingPointRight;
            }
            leg.solveIK(standingPoint);
          }
          leg.calculateFK();
          lastGaitCount = gaitCountRef.current;
        });

        bodies[0].update();
        bodies[0].draw();
        legs.forEach((leg) => {
          leg.draw(ctx, convert3DtoIsometric);
        });

        gaitCycle += 1;
        gaitCycle2 += 1;
        gaitCycle2 %= 360 - gaitCountRef.current;
        gaitCycle %= 360 - gaitCountRef.current;

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
            Walking Speed:
            <input
              type="range"
              min="45"
              max="330"
              value={gaitCountRef.current}
              onChange={(e) => {
                gaitCountRef.current = Number(e.target.value);
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
