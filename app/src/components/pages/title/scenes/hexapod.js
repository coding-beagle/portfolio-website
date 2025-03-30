import React, { useEffect, useRef, useState } from "react";
import defaultColours from "../../../../themes/themes";

export default function Hexapod() {
  const canvasRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const mouseClickRef = useRef(false);
  const simulationSpeedRef = useRef(100);
  const bodyRefs = useRef([]);
  const mouseShieldRadiusRef = useRef(100);
  const [, setRender] = useState(0); // Dummy state to force re-render

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

    const convert2DtoIsometric = (position) => {
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
    const FEMUR_LENGTH = 45;
    const TIBIA_LENGTH = 70;
    const GROUND_LEVEL_Z = -80; // Where the feet ideally rest
    const BODY_HEIGHT_Z = -30 / 2; // From your body definition (z: -h2)

    // Sanity check for reachability
    const MAX_REACH = COXA_LENGTH + FEMUR_LENGTH + TIBIA_LENGTH;

    const LegState = {
      STANCE: 0,
      SWING: 1,
    };

    class Leg {
      constructor(id, bodyAttachmentLocal, defaultFootPosLocal) {
        this.id = id; // 0-5
        this.bodyAttachmentLocal = bodyAttachmentLocal; // {x,y,z} relative to body center
        this.defaultFootPosLocal = defaultFootPosLocal; // {x,y,z} relative to body center

        // Current state
        this.angles = { coxa: 0, femur: 0, tibia: 0 }; // Radians
        // World positions of joints (calculated by FK)
        this.joints = {
          coxa: { ...this.bodyAttachmentLocal }, // Coxa pivot = attachment
          femur: { x: 0, y: 0, z: 0 }, // Knee joint
          tibia: { x: 0, y: 0, z: 0 }, // Ankle joint (often same as foot)
          foot: { x: 0, y: 0, z: 0 }, // End effector
        };
        this.targetFootPosWorld = { x: 0, y: 0, z: 0 };

        this.state = LegState.STANCE; // Start in stance
        this.swingPhase = 0; // Progress through swing (0 to 1)
        this.fixedStancePosition = { x: 0, y: 0, z: 0 }; // World position where foot is planted
        this.swingStartPos = { x: 0, y: 0, z: 0 }; // World position where swing started
        this.swingTargetLandingPos = { x: 0, y: 0, z: 0 }; // Calculated world position where foot should land
        this.isReachable = true;
      }

      startSwing(currentTime, targetLandingPos, swingDuration) {
        this.state = LegState.SWING;
        this.swingStartPos = { ...this.joints.foot }; // Capture current actual foot position
        this.swingTargetLandingPos = targetLandingPos;
        this.swingPhase = 0; // Reset phase progress
        this.lastUpdateTime = currentTime; // Track time for phase calculation
        this.currentSwingDuration = swingDuration;
      }

      // NEW: Method to start the stance phase
      startStance(currentTime) {
        this.state = LegState.STANCE;
        // Record the foot's current position when it lands as the fixed point
        this.fixedStancePosition = { ...this.joints.foot };
        // Optional: Force Z to ground level precisely on landing
        this.fixedStancePosition.z = GROUND_LEVEL_Z;
        this.joints.foot.z = GROUND_LEVEL_Z; // Ensure foot position matches
      }

      update(bodyWorldPos, bodyAngle, gaitParams) {
        // Pass gait timing parameters
        const { currentTime, stepHeight, deltaTime } = gaitParams;

        if (this.state === LegState.STANCE) {
          // --- Stance Phase ---
          // Target remains fixed where the foot landed.
          this.targetFootPosWorld = this.fixedStancePosition;
        } else {
          // --- Swing Phase ---
          // Calculate progress through the swing phase (0 to 1)
          if (!this.lastUpdateTime)
            this.lastUpdateTime = currentTime - deltaTime; // Handle first frame
          this.swingPhase += deltaTime / this.currentSwingDuration;
          this.swingPhase = Math.min(1.0, this.swingPhase); // Clamp phase to 0-1

          // Interpolate XY position linearly from start to target landing spot
          const lerp = (a, b, t) => a + (b - a) * t;
          const interpX = lerp(
            this.swingStartPos.x,
            this.swingTargetLandingPos.x,
            this.swingPhase
          );
          const interpY = lerp(
            this.swingStartPos.y,
            this.swingTargetLandingPos.y,
            this.swingPhase
          );

          // Calculate Z height using a sine arc for lift
          // Lerp base Z from start to landing Z, then add arc
          const baseZ = lerp(
            this.swingStartPos.z,
            this.swingTargetLandingPos.z,
            this.swingPhase
          );
          const arcZ = baseZ + Math.sin(this.swingPhase * Math.PI) * stepHeight;

          this.targetFootPosWorld = { x: interpX, y: interpY, z: arcZ };

          // Check if swing is complete (handle potential floating point issues)
          if (this.swingPhase >= 1.0) {
            //  this.startStance(currentTime); // Let Body controller handle state switching precisely at step end
            // For now, just ensure target is exactly landing pos at end
            this.targetFootPosWorld = { ...this.swingTargetLandingPos };
          }
        }
        this.lastUpdateTime = currentTime; // Store time for next frame's deltaTime calc within swing

        // --- Solve IK and Calculate Joint Positions (as before) ---
        this.solveIK(this.targetFootPosWorld, bodyWorldPos, bodyAngle);
        // Only calculate FK if IK was successful (target reachable)
        if (this.isReachable) {
          this.calculateJointPositions(bodyWorldPos, bodyAngle);
        } else {
          // If target unreachable during swing, maybe just keep old joint positions?
          // This prevents legs snapping if target jumps too far
        }
      }

      solveIK(targetWorldFootPos, bodyWorldPos, bodyAngle) {
        // --- Transform target position into the body's rotated coordinate frame ---
        // World position of the coxa pivot point
        const rotatedAttachment = rotatePointZ(
          this.bodyAttachmentLocal,
          bodyAngle
        );
        const worldCoxaPivot = vecAdd(bodyWorldPos, rotatedAttachment);

        // Vector from coxa pivot to target foot in world space
        const coxaToTargetWorld = vecSub(targetWorldFootPos, worldCoxaPivot);

        // --- Calculate Coxa Angle (Yaw) ---
        // Project coxaToTargetWorld onto the world XY plane and find angle
        // Angle relative to the body's forward direction (which is along its rotated local Y axis if angle=0 means X-axis)
        // We need the angle relative to the leg's "zero" orientation when body angle is 0.
        // Let's find the angle relative to the world X axis first.
        let coxaWorldAngle = Math.atan2(
          coxaToTargetWorld.y,
          coxaToTargetWorld.x
        );

        // We need the angle relative to the leg's starting orientation *within the body frame*
        // Calculate the leg's base angle when bodyAngle is 0
        const legBaseAngle = Math.atan2(
          this.bodyAttachmentLocal.y,
          this.bodyAttachmentLocal.x
        );

        // The desired coxa angle is the difference between the world target angle and the body's angle,
        // adjusted by the leg's base angle. (This needs careful check depending on conventions)
        // Let's try a simpler approach: rotate target into body frame *first*.

        // --- Alternative IK Approach: Work in Body's Rotated Frame ---
        // 1. Target relative to body center
        const targetRelativeToBody = vecSub(targetWorldFootPos, bodyWorldPos);
        // 2. Rotate target into body's *local* frame (inverse rotation)
        const targetLocal = rotatePointZ(targetRelativeToBody, -bodyAngle);
        // 3. Vector from local coxa attachment to local target
        const coxaToTargetLocal = vecSub(targetLocal, this.bodyAttachmentLocal);

        // --- Coxa Angle Calculation (using local coords) ---
        // Angle in the XY plane relative to the body's frame
        this.angles.coxa = Math.atan2(coxaToTargetLocal.y, coxaToTargetLocal.x);

        // --- Femur and Tibia Angle Calculation (2D IK in the leg's plane) ---
        // Calculate the distance from the coxa pivot to the target in 3D
        const distCoxaToFoot = vecMag(coxaToTargetLocal);

        // Check reachability
        if (
          distCoxaToFoot > FEMUR_LENGTH + TIBIA_LENGTH ||
          distCoxaToFoot < Math.abs(FEMUR_LENGTH - TIBIA_LENGTH)
        ) {
          this.isReachable = false;
          // Optional: Clamp angles to max reach / min reach if needed
          // For now, just flag it and maybe use previous angles or a default pose
          return; // Exit if not reachable
        }
        this.isReachable = true;

        // Calculate the height difference (Z) and planar distance (L)
        const deltaZ = coxaToTargetLocal.z; // Target Z relative to coxa pivot Z
        // Planar distance squared (in the leg's rotated vertical plane)
        const planarDistSq =
          coxaToTargetLocal.x * coxaToTargetLocal.x +
          coxaToTargetLocal.y * coxaToTargetLocal.y;
        const planarDist = Math.sqrt(planarDistSq);

        // Total length from coxa pivot (in body frame) out to foot target along the leg plane's "floor"
        // This is sqrt(planarDist^2 + deltaZ^2), but we already have distCoxaToFoot which is the 3D distance.
        // Let's rethink: We need the distance in the plane rotated by coxa angle.
        const L = Math.sqrt(planarDistSq); // Horizontal distance from coxa pivot to target projection on XY plane
        const distCoxaToFootPlane = Math.sqrt(L * L + deltaZ * deltaZ); // Should equal distCoxaToFoot if L was calculated correctly relative to coxa angle

        // Use Law of Cosines to find angles alpha (at coxa) and beta (at knee/femur joint)
        // Angle alpha1 at coxa pivot, between horizontal plane and coxa-foot vector
        const alpha1 = Math.atan2(-deltaZ, L); // Angle relative to the leg's horizontal plane

        // Angle alpha2 using Law of Cosines for triangle (Femur, Tibia, distCoxaToFoot)
        // cos(alpha2) = (Femur^2 + distCoxaToFoot^2 - Tibia^2) / (2 * Femur * distCoxaToFoot)
        const cosAlpha2 =
          (FEMUR_LENGTH * FEMUR_LENGTH +
            distCoxaToFoot * distCoxaToFoot -
            TIBIA_LENGTH * TIBIA_LENGTH) /
          (2 * FEMUR_LENGTH * distCoxaToFoot);
        // Clamp due to potential floating point errors
        const clampedCosAlpha2 = Math.max(-1.0, Math.min(1.0, cosAlpha2));
        const alpha2 = Math.acos(clampedCosAlpha2);

        // Femur angle relative to the horizontal plane of the leg
        this.angles.femur = alpha1 + alpha2;

        // Angle beta at knee joint using Law of Cosines
        // cos(beta) = (Femur^2 + Tibia^2 - distCoxaToFoot^2) / (2 * Femur * Tibia)
        const cosBeta =
          (FEMUR_LENGTH * FEMUR_LENGTH +
            TIBIA_LENGTH * TIBIA_LENGTH -
            distCoxaToFoot * distCoxaToFoot) /
          (2 * FEMUR_LENGTH * TIBIA_LENGTH);
        const clampedCosBeta = Math.max(-1.0, Math.min(1.0, cosBeta));
        const beta = Math.acos(clampedCosBeta);

        // Tibia angle relative to the femur segment. Often defined as deviation from straight.
        // Beta is the inner angle. Tibia angle often relative to femur's line.
        this.angles.tibia = beta - Math.PI; // Adjust convention if needed
      }

      calculateJointPositions(bodyWorldPos, bodyAngle) {
        if (!this.isReachable) {
          // Handle unreachable state - maybe keep previous positions or go to default
          // For simplicity, let's just recalculate a default pose if unreachable
          // Or better: Do nothing, joints stay where they were.
          return;
        }

        // --- Calculate World Position of Coxa Pivot ---
        const rotatedAttachment = rotatePointZ(
          this.bodyAttachmentLocal,
          bodyAngle
        );
        this.joints.coxa = vecAdd(bodyWorldPos, rotatedAttachment);

        // --- Calculate World Position of Femur Joint (Knee) ---
        // Start with a vector along the leg's X axis (in its rotated plane)
        let femurVecLocal = { x: FEMUR_LENGTH, y: 0, z: 0 };
        // Rotate it by femur angle around the leg's Y axis (vertical in its plane)
        let cosF = Math.cos(this.angles.femur);
        let sinF = Math.sin(this.angles.femur);
        let femurVecRotatedPlane = {
          x: femurVecLocal.x * cosF - femurVecLocal.z * sinF,
          y: femurVecLocal.y,
          z: femurVecLocal.x * sinF + femurVecLocal.z * cosF,
        };

        // Rotate this vector by the coxa angle around the Z axis
        let femurVecWorld = rotatePointZ(
          femurVecRotatedPlane,
          this.angles.coxa
        );

        // Add to coxa pivot world position
        this.joints.femur = vecAdd(this.joints.coxa, femurVecWorld);

        // --- Calculate World Position of Tibia Joint (Foot) ---
        let tibiaVecLocal = { x: TIBIA_LENGTH, y: 0, z: 0 };
        // Rotate by tibia angle relative to femur's direction
        let cosT = Math.cos(this.angles.tibia);
        let sinT = Math.sin(this.angles.tibia);
        // Angle is relative to femur, so add femur angle for rotation in leg plane
        let combinedAngle = this.angles.femur + this.angles.tibia;
        let cosFT = Math.cos(combinedAngle);
        let sinFT = Math.sin(combinedAngle);

        let tibiaVecRotatedPlane = {
          x: tibiaVecLocal.x * cosFT - tibiaVecLocal.z * sinFT,
          y: tibiaVecLocal.y,
          z: tibiaVecLocal.x * sinFT + tibiaVecLocal.z * cosFT,
        };

        // Rotate this vector by the coxa angle
        let tibiaVecWorld = rotatePointZ(
          tibiaVecRotatedPlane,
          this.angles.coxa
        );

        // Add to FEMUR joint world position
        this.joints.foot = vecAdd(this.joints.femur, tibiaVecWorld); // ISSUE: Should be added to femur joint? No, this calc seems off.

        // --- Recalculate FK directly ---
        // Femur Joint: Rotate a point {COXA_LENGTH, 0, 0} by coxa angle, add to attachment point. (IF coxa has length)
        // Let's assume COXA_LENGTH = 0 for simplicity based on previous steps. Coxa joint = attachment point.
        // World Knee Pos: Start with vector {FemurLength, 0, 0}. Rotate by Femur Angle around Y'. Rotate by Coxa Angle around Z. Add to World Coxa Pivot.
        // World Foot Pos: Start with vector {TibiaLength, 0, 0}. Rotate by Tibia Angle around Y''. Rotate result by Femur Angle around Y'. Rotate result by Coxa Angle around Z. Add to World Knee Pos.

        // FK Recalculation (Simpler conceptual chain):
        // 1. Coxa joint world pos = calculated earlier.
        this.joints.coxa = vecAdd(
          bodyWorldPos,
          rotatePointZ(this.bodyAttachmentLocal, bodyAngle)
        );

        // 2. Calculate Femur (Knee) joint world pos
        // Vector from Coxa pivot to Knee in world frame
        const coxaToKnee = {
          x:
            FEMUR_LENGTH *
            Math.cos(this.angles.femur) *
            Math.cos(this.angles.coxa),
          y:
            FEMUR_LENGTH *
            Math.cos(this.angles.femur) *
            Math.sin(this.angles.coxa),
          z: -FEMUR_LENGTH * Math.sin(this.angles.femur), // Femur angle rotates downwards for positive Z
        };
        // This simplified FK assumes angles are directly usable in world frame rotations which isn't quite right.
        // A proper FK chain uses transformation matrices or sequential rotations relative to parent frames.

        // Let's use the calculated angles and apply them sequentially:
        // Start with a vector pointing along the coxa direction:
        const coxaDir = {
          x: Math.cos(this.angles.coxa),
          y: Math.sin(this.angles.coxa),
          z: 0,
        };
        // A vector perpendicular to this in the leg plane (vertical)
        const verticalDir = { x: 0, y: 0, z: 1 }; // Simplified assumption
        // A vector forward in the leg plane
        const femurDirLocal = {
          x: Math.cos(this.angles.femur),
          y: 0,
          z: -Math.sin(this.angles.femur),
        }; // In leg's local XY' plane (Y' is Z axis)

        // Rotate femurDirLocal by coxa angle
        const femurDirWorld = rotatePointZ(femurDirLocal, this.angles.coxa);
        this.joints.femur = vecAdd(
          this.joints.coxa,
          vecScale(femurDirWorld, FEMUR_LENGTH)
        );

        // Now for the tibia segment
        const tibiaDirLocal = {
          x: Math.cos(this.angles.femur + this.angles.tibia),
          y: 0,
          z: -Math.sin(this.angles.femur + this.angles.tibia),
        };
        const tibiaDirWorld = rotatePointZ(tibiaDirLocal, this.angles.coxa);
        this.joints.foot = vecAdd(
          this.joints.femur,
          vecScale(tibiaDirWorld, TIBIA_LENGTH)
        );
      }

      draw() {
        if (!this.isReachable) {
          // Draw differently maybe? Dashed line? Red?
          ctx.strokeStyle = "red";
        } else {
          // Use default leg color
          ctx.strokeStyle =
            typeof defaultColours !== "undefined"
              ? defaultColours.secondaryAccent
              : "lime";
        }

        // Project the calculated world joint positions
        const pCoxa = convert2DtoIsometric(this.joints.coxa);
        const pFemur = convert2DtoIsometric(this.joints.femur); // Knee
        const pFoot = convert2DtoIsometric(this.joints.foot);

        // Draw Coxa segment (if it had length > 0, from body attach to coxa joint)
        // Currently coxa joint IS the attachment, so we draw Femur & Tibia

        // Draw Femur (Coxa Joint to Femur Joint/Knee)
        ctx.moveTo(pCoxa[0], pCoxa[1]);
        ctx.lineTo(pFemur[0], pFemur[1]);

        // Draw Tibia (Femur Joint/Knee to Foot)
        ctx.moveTo(pFemur[0], pFemur[1]);
        ctx.lineTo(pFoot[0], pFoot[1]);

        // Optional: Draw target point small circle
        // const pTarget = convert2DtoIsometric(this.targetFootPosWorld);
        // ctx.fillStyle = 'yellow';
        // ctx.fillRect(pTarget[0]-1, pTarget[1]-1, 3, 3);
      }
    }

    class Body {
      constructor(x, y, z, width = 50, length = 80, height = 30) {
        this.position = { x: x, y: y, z: z }; // Body's center in world 3D space
        this.angle = 0; // Angle (radians) around Z axis - determines facing direction
        this.speed = 15.0;
        this.rotationOffset = (-1 * Math.PI) / 4; // User's offset

        const w2 = width / 2;
        const l2 = length / 2;
        const h2 = height / 2;
        const bodyZ = -h2; // Z coordinate of body vertices

        this.localVertices = [
          { x: -w2, y: -l2, z: bodyZ }, // 0: bottom-left-back
          { x: -w2 * 1.5, y: 0, z: bodyZ }, // 1: middle-left
          { x: -w2, y: l2, z: bodyZ }, // 2: bottom-left-front
          { x: w2, y: l2, z: bodyZ }, // 3: bottom-right-front
          { x: w2 * 1.5, y: 0, z: bodyZ }, // 4: middle-right
          { x: w2, y: -l2, z: bodyZ }, // 5: bottom-right-back
        ];
        this.edges = [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 4],
          [4, 5],
          [5, 0],
        ];

        // --- Gait Parameters ---
        this.gaitTime = 0;
        this.stepDuration = 0.6; // seconds for a full step cycle (adjust for speed)
        this.swingDurationFraction = 0.4; // % of step duration leg is in the air
        this.stepHeight = 30; // How high feet lift during swing
        this.gaitGroups = {
          // Tripod groups based on leg index 0-5
          A: [0, 3, 4], // L-back, R-back, R-mid
          B: [1, 2, 5], // L-mid, L-front, R-front
        };
        this.activeSwingGroup = "B"; // Start with Group B swinging

        // --- Instantiate Legs ---
        this.legs = [];
        const legAttachmentIndices = [0, 1, 2, 5, 4, 3]; // Order matches visual layout L-back, L-mid, L-front, R-back, R-mid, R-front
        const defaultStanceWidth = w2 * 1.5 + COXA_LENGTH + FEMUR_LENGTH / 2; // Estimate X distance
        const defaultStanceLength = l2 + COXA_LENGTH + FEMUR_LENGTH / 2; // Estimate Y distance

        const defaultFootPositionsLocal = [
          {
            x: -defaultStanceWidth,
            y: -defaultStanceLength,
            z: GROUND_LEVEL_Z - bodyZ,
          }, // Leg 0 (L Back) - Z relative to body center!
          { x: -defaultStanceWidth * 1.2, y: 0, z: GROUND_LEVEL_Z - bodyZ }, // Leg 1 (L Mid)
          {
            x: -defaultStanceWidth,
            y: defaultStanceLength,
            z: GROUND_LEVEL_Z - bodyZ,
          }, // Leg 2 (L Front)
          {
            x: defaultStanceWidth,
            y: -defaultStanceLength,
            z: GROUND_LEVEL_Z - bodyZ,
          }, // Leg 3 (R Back)
          { x: defaultStanceWidth * 1.2, y: 0, z: GROUND_LEVEL_Z - bodyZ }, // Leg 4 (R Mid)
          {
            x: defaultStanceWidth,
            y: defaultStanceLength,
            z: GROUND_LEVEL_Z - bodyZ,
          }, // Leg 5 (R Front)
        ];

        for (let i = 0; i < 6; i++) {
          const attachIndex = legAttachmentIndices[i];
          const attachmentLocal = this.localVertices[attachIndex];
          const defaultFootLocal = defaultFootPositionsLocal[i];
          this.legs.push(new Leg(i, attachmentLocal, defaultFootLocal));
        }
        // --- End Legs ---

        this.initGait();

        this.projectedCenter = convert2DtoIsometric(this.position);
      }

      initGait() {
        // Set initial stance positions for all legs
        const initialTime = performance.now() / 1000.0; // Use current time
        this.legs.forEach((leg) => {
          const rotatedDefaultFootPos = rotatePointZ(
            leg.defaultFootPosLocal,
            this.angle
          ); // Use initial angle (usually 0)
          const initialWorldFootPos = vecAdd(
            this.position,
            rotatedDefaultFootPos
          );
          initialWorldFootPos.z = GROUND_LEVEL_Z; // Force to ground

          leg.fixedStancePosition = { ...initialWorldFootPos }; // Set fixed position
          leg.joints.foot = { ...initialWorldFootPos }; // Set current position
          leg.state = LegState.STANCE; // Ensure all start in stance
        });

        // Immediately trigger the first swing group (optional, could wait for movement)
        // this.triggerGroupSwing(this.activeSwingGroup, initialTime);
        // Reset gait timer
        this.gaitTime = 0;
      }

      // NEW: Helper to calculate where a leg should land after swing
      calculateLandingPosition(leg) {
        // Simple approach: Target the default position relative to *current* body pos/angle
        const rotatedDefaultFootPos = rotatePointZ(
          leg.defaultFootPosLocal,
          this.angle
        );
        const targetLandingWorld = vecAdd(this.position, rotatedDefaultFootPos);
        targetLandingWorld.z = GROUND_LEVEL_Z; // Land on ground

        // More advanced: Predict where body *will be* after swing duration based on current velocity
        // const predictMoveX = Math.cos(this.angle) * this.speed * (this.stepDuration * this.swingDurationFraction);
        // const predictMoveY = Math.sin(this.angle) * this.speed * (this.stepDuration * this.swingDurationFraction);
        // targetLandingWorld.x += predictMoveX;
        // targetLandingWorld.y += predictMoveY;

        return targetLandingWorld;
      }

      // NEW: Helper to trigger state changes
      triggerGroupSwing(groupName, currentTime) {
        const swingDuration = this.stepDuration * this.swingDurationFraction;
        this.legs.forEach((leg) => {
          if (this.gaitGroups[groupName].includes(leg.id)) {
            // This leg should start swinging
            const targetLandingPos = this.calculateLandingPosition(leg);
            leg.startSwing(currentTime, targetLandingPos, swingDuration);
          } else {
            // This leg should ensure it's in stance (or start stance if just finished swing)
            if (leg.state !== LegState.STANCE) {
              // Only call startStance if it wasn't already
              leg.startStance(currentTime);
            }
          }
        });
      }

      update(targetMouseX, targetMouseY, deltaTime) {
        // Pass deltaTime
        if (!deltaTime || deltaTime <= 0) deltaTime = 1 / 60.0; // Avoid issues on first frame or pauses

        // --- 1. Update Body Orientation & Position ---
        this.projectedCenter = convert2DtoIsometric(this.position);
        const dxScreen = targetMouseX - this.projectedCenter[0];
        const dyScreen = targetMouseY - this.projectedCenter[1];
        this.angle = Math.atan2(dyScreen, dxScreen) + this.rotationOffset;

        const moveX = Math.cos(this.angle);
        const moveY = Math.sin(this.angle);
        // Use deltaTime for frame-rate independent movement
        this.position.x += moveX * this.speed * deltaTime;
        this.position.y += moveY * this.speed * deltaTime;

        // --- 2. Gait Controller Logic ---
        this.gaitTime += deltaTime;
        const currentTime = performance.now() / 1000.0; // Get current time

        // Check if it's time to switch which group is swinging
        if (this.gaitTime >= this.stepDuration) {
          this.gaitTime = this.gaitTime % this.stepDuration; // Reset cycle time smoothly

          // Switch active group
          this.activeSwingGroup = this.activeSwingGroup === "A" ? "B" : "A";

          // Trigger the state changes for the new swing/stance groups
          this.triggerGroupSwing(this.activeSwingGroup, currentTime);
        }

        // --- 3. Update Individual Legs ---
        const gaitParams = {
          currentTime: currentTime,
          stepHeight: this.stepHeight,
          deltaTime: deltaTime, // Pass deltaTime to leg update if needed for swing calc
          swingDuration: this.stepDuration * this.swingDurationFraction,
        };
        this.legs.forEach((leg) => {
          leg.update(this.position, this.angle, gaitParams);
        });
      }

      draw() {
        // Pass ctx in
        // 1. Draw Body (as before)
        const finalProjectedBodyVertices = [];
        this.localVertices.forEach((vertex) => {
          // Recalculate world vertex for drawing body
          const rotatedVertex = rotatePointZ(vertex, this.angle);
          const worldVertex = vecAdd(this.position, rotatedVertex);
          finalProjectedBodyVertices.push(convert2DtoIsometric(worldVertex));
        });

        ctx.beginPath();
        ctx.strokeStyle =
          typeof defaultColours !== "undefined"
            ? defaultColours.accent
            : "white";
        this.edges.forEach((edgeIndices) => {
          const startPoint = finalProjectedBodyVertices[edgeIndices[0]];
          const endPoint = finalProjectedBodyVertices[edgeIndices[1]];
          ctx.moveTo(startPoint[0], startPoint[1]);
          ctx.lineTo(endPoint[0], endPoint[1]);
        });
        ctx.stroke();
        ctx.closePath();

        // 2. Draw Legs
        ctx.beginPath(); // Start new path for all leg segments
        this.legs.forEach((leg) => {
          leg.draw(ctx); // Leg draw method now handles its own segments
        });
        // Stroke all leg segments drawn in leg.draw()
        // Need to manage strokeStyle within leg.draw or ensure it's set before this loop
        ctx.stroke(); // Stroke all leg lines at once
        ctx.closePath(); // Might not be needed if leg.draw doesn't use paths
      }
    }

    let lastTime = 0;
    function animate(currentTime) {
      // Calculate deltaTime (time since last frame in seconds)
      currentTime = currentTime / 1000.0; // Convert ms to seconds
      const deltaTime = currentTime - (lastTime || currentTime); // Handle first frame
      lastTime = currentTime;

      // Clamp deltaTime to prevent large jumps if tab loses focus
      const clampedDeltaTime = Math.min(deltaTime, 1 / 15); // Max step of 1/15th second

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Pass deltaTime to the update function
      bodyRefs.current[0].update(
        mousePosRef.current.x,
        mousePosRef.current.y,
        clampedDeltaTime
      );
      bodyRefs.current[0].draw(ctx);

      requestAnimationFrame(animate);
    }

    const init = () => {
      if (bodyRefs.current.length === 0) {
        bodyRefs.current.push(new Body(500, 100, 0));
      }
    };

    init();
    animate();

    canvas.addEventListener("pointermove", handleMouseMove);
    canvas.addEventListener("touchmove", handleMouseMove);
    canvas.addEventListener("pointerdown", handleMouseDown);
    canvas.addEventListener("pointerup", handleMouseUp);

    return () => {
      // Cleanup function to cancel the animation frame and remove event listeners
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener("pointermove", handleMouseMove);
      canvas.removeEventListener("touchmove", handleMouseMove);
      canvas.removeEventListener("pointerdown", handleMouseDown);
      canvas.removeEventListener("pointerup", handleMouseUp);
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "0.5em",
            }}
          >
            Click Umbrella Radius:
            <input
              type="range"
              min="10.0"
              max="300.0"
              value={mouseShieldRadiusRef.current}
              onChange={(e) => {
                mouseShieldRadiusRef.current = Number(e.target.value);
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
