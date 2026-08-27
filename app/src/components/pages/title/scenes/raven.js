import React, { useEffect, useRef, useState, useContext } from "react";
import { ChangerGroup } from "../utilities/valueChangers";
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { scaleValue } from "../utilities/usefulFunctions";
import { IconGroup } from "../utilities/popovers";
import { MobileContext } from "../../../../contexts/MobileContext";
import { createPointerTracker } from "../utilities/engine";

export default function Raven({ visibleUI }) {
  const mobile = useContext(MobileContext)
  const refContainer = useRef(null);
  const mounted = useRef(false);

  const crowRef = useRef(null);
  const mouseposref = useRef({ x: 0, y: 0 })
  const [, setRender] = useState(0);


  useEffect(() => {
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    // use ref as a mount point of the Three.js scene instead of the document.body
    refContainer.current && !mounted.current && refContainer.current.appendChild(renderer.domElement);
    mounted.current = true;

    let min_rotation_x;
    let max_rotation_x;
    if (mobile) {
      min_rotation_x = -0.5;
      max_rotation_x = 0.5;
    } else {
      min_rotation_x = -0.3;
      max_rotation_x = 1.0;
    }

    const min_rotation_y = -0.5;
    const max_rotation_y = 0.5;

    const color = 0xFFFFFF;
    const intensity = 1;
    const light = new THREE.AmbientLight(color, intensity);
    scene.add(light);


    const objLoader = new OBJLoader();
    const mtlLoader = new MTLLoader();

    var crow

    mtlLoader.load('resources/crow.mtl', (mtl) => {
      mtl.preload();
      objLoader.setMaterials(mtl);

      objLoader.load('resources/crow.obj', (root) => {
        root.scale.set(0.01, 0.01, 0.01); // Scale up the model

        if (mobile) {
          root.position.set(0.0, -1, -1); // Center it
        } else {
          root.position.set(-0.5, -1, -1); // Center it

        }
        crow = root;
        scene.add(root);
        crowRef.current = root;
      });
    });

    let animationFrameId;

    var animate = function () {

      if (crowRef.current) {
        let rect;
        try {
          rect = refContainer.current.getBoundingClientRect();
        } catch (e) {
          cancelAnimationFrame(animationFrameId);
          return
        }
        const width = rect.width;
        const height = rect.height;

        const new_rotation_x = scaleValue(mouseposref.current.x, 0, width, min_rotation_x, max_rotation_x);
        const new_rotation_y = scaleValue(mouseposref.current.y, 0, height, min_rotation_y, max_rotation_y);
        crow.rotation.y = new_rotation_x;
        crow.rotation.x = new_rotation_y;

      }
      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);

    };
    animate();

    // The container is not a canvas, but it is what the pointer is measured
    // against, so the shared tracker works here just the same.
    const disposePointer = createPointerTracker(refContainer.current, {
      posRef: mouseposref,
      preventScroll: false,
    });

    return () => {
      cancelAnimationFrame(animationFrameId);
      disposePointer();

      if (refContainer.current && renderer.domElement) {
        refContainer.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [mobile]);

  return (
    <>
      <div ref={refContainer} style={{
        position: "absolute",
        top: 0,
        left: 0,
        overflow: "hidden",
        maxHeight: "var(--app-height)"
      }} />

      {visibleUI && (
        <div style={{ zIndex: 3000 }}>
          <ChangerGroup
            valueArrays={[
              // {
              //   title: "Simulation Speed:",
              //   valueRef: simulationSpeedRef,
              //   minValue: "1",
              //   maxValue: "200.0",
              //   type: CHANGER_TYPE.SLIDER,
              // },
            ]}
            rerenderSetter={setRender}
          />
          <IconGroup icons={[
            { type: "MOUSE" },
          ]} />
        </div>
      )}
    </>
  );
}
