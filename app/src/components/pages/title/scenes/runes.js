import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { IconGroup } from "../utilities/popovers";
import { ChangerGroup } from "../utilities/valueChangers";
import { clamp, distanceBetweenTwoPoints, ElementCollisionHitbox, getRandomColour } from "../utilities/usefulFunctions";

export default function Runes({ visibleUI }) {
    const { theme } = useTheme();
    const canvasRef = useRef(null);

    const mousePosRef = useRef({ x: 0, y: 0 });
    const mouseClickRef = useRef(false);

    const particleCountRef = useRef(10);
    const simulationSpeedRef = useRef(100);
    const mouseShieldRadiusRef = useRef(100);
    const windspeedRef = useRef(Math.round((Math.random() - 0.5) * 100));
    const titleShieldRadiusRef = useRef(30);
    const recalculateRectRef = useRef(() => { });
    const visibleUIRef = useRef(visibleUI);
    const [, setRender] = useState(0); // Dummy state to force re-render

    useEffect(() => {

        let particles = [];
        const gravity = 0.5;
        let animationFrameId;
        const maxFallSpeed = 13;
        const maxWindSpeed = 6;

        const titleHitbox = new ElementCollisionHitbox("title", 20, titleShieldRadiusRef)
        // const iconsHitbox = new ElementCollisionHitbox("linkIcons", 20, titleShieldRadiusRef)

        let collisionElements = [titleHitbox];

        const recalculateRect = () => {
            collisionElements.forEach((hitbox) => { hitbox.recalculate() })
        };

        recalculateRectRef.current = recalculateRect;

        const canvas = canvasRef.current;
        const resizeCanvas = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            recalculateRect();
        };
        resizeCanvas();
        window.addEventListener("resize", resizeCanvas);
        window.addEventListener("popstate", recalculateRect);
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

        const handleTouchMove = (event) => {
            if (event.touches && event.touches.length > 0) {
                const rect = canvas.getBoundingClientRect();
                const touch = event.touches[0];
                mousePosRef.current = {
                    x: touch.clientX - rect.left,
                    y: touch.clientY - rect.top,
                };
            }
        };

        const handleTouchStart = () => {
            mouseClickRef.current = true;
        };

        const handleTouchEnd = () => {
            mouseClickRef.current = false;
        };

        // --- Touch event handler to prevent scroll on drag ---
        function handleTouchDragPreventScroll(e) {
            if (e.touches && e.touches.length > 0) {
                e.preventDefault();
            }
        }

        recalculateRect();

        const maxSize = 200;
        const minDistanceBetweenPoints = 30;
        const minDistanceBetweenRunes = 100;
        const maxPoints = 10;
        const minPoints = 5;
        const maxActiveCount = 150

        class Rune {
            constructor(x, y) {
                this.x = x;
                this.y = y;
                this.points = this.populatePoints(clamp(Math.round(Math.random() * 10), minPoints, maxPoints))
                this.closedRune = Math.random() > 0.5;
                this.color = getRandomColour();
                this.active = false;
                this.activeCount = 0;
            }

            populatePoints(numPoints) {
                const points = [];
                let attempts = 0;
                const maxAttempts = numPoints * 100;

                while (points.length < numPoints && attempts < maxAttempts) {
                    const candidate = {
                        x: (Math.random() - 0.5) * maxSize,
                        y: (Math.random() - 0.5) * maxSize
                    };

                    const tooClose = points.some(existing =>
                        distanceBetweenTwoPoints(candidate, existing) < minDistanceBetweenPoints
                    );

                    if (!tooClose) {
                        points.push(candidate);
                    }
                    attempts++;
                }

                return points;
            }

            update() {
                const dx = this.x - mousePosRef.current.x;
                const dy = this.y - mousePosRef.current.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < mouseShieldRadiusRef.current) {
                    if (this.activeCount < maxActiveCount) {
                        this.activeCount += 5;
                    }
                }

                if (this.activeCount > 0) {
                    this.activeCount--;
                }
                this.active = this.activeCount !== 0;
            }

            draw() {
                ctx.beginPath()
                const firstPoint = this.points[0]
                const firstPointX = firstPoint.x + this.x;
                const firstPointY = firstPoint.y + this.y;
                ctx.moveTo(firstPointX, firstPointY)

                for (let currentPointIndex = 1; currentPointIndex < this.points.length; currentPointIndex++) {
                    const point = this.points[currentPointIndex]
                    const pointX = point.x + this.x;
                    const pointY = point.y + this.y;
                    ctx.lineTo(pointX, pointY);
                    ctx.strokeStyle = this.active ? this.color : theme.accent;
                    ctx.lineWidth = 10
                }
                ctx.stroke()

                ctx.closePath();
            }
        }

        function initParticles() {
            particles = [];

            const points = [];
            let attempts = 0;
            const maxAttempts = particleCountRef.current * 100;

            while (points.length < particleCountRef.current && attempts < maxAttempts) {
                const candidate = {
                    x: (Math.random()) * canvasRef.current.width,
                    y: (Math.random()) * canvasRef.current.height
                };

                const tooClose = points.some(existing =>
                    distanceBetweenTwoPoints(candidate, existing) < minDistanceBetweenRunes
                );

                if (!tooClose) {
                    points.push(candidate);
                }
                attempts++;
            }

            points.forEach((point) => {
                particles.push(new Rune(point.x, point.y))
            })


        }

        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            collisionElements.forEach((element) => {
                if (visibleUIRef.current && !element.elementObject) {
                    element.tryUpdateElement(element.elementName);
                } else {
                    element.elementObject = null;
                }

                if (element) {
                    element.recalculate()
                }
            })

            // Adjust particle count
            const currentParticleCount = particles.length;
            if (currentParticleCount < particleCountRef.current) {
                for (let i = currentParticleCount; i < particleCountRef.current; i++) {
                    const x = Math.random() * canvas.width;
                    const y = Math.random() * canvas.height;
                    particles.push(new Rune(x, y));
                }
            } else if (currentParticleCount > particleCountRef.current) {
                particles.splice(particleCountRef.current);
            }

            particles.forEach((particle) => {
                particle.update();
                particle.draw();
            });
            animationFrameId = requestAnimationFrame(animate);
        }

        initParticles();
        animate();

        window.addEventListener("pointermove", handleMouseMove);
        window.addEventListener("pointerdown", handleMouseDown);
        window.addEventListener("pointerup", handleMouseUp);
        window.addEventListener("touchmove", handleTouchMove);
        window.addEventListener("touchstart", handleTouchStart);
        window.addEventListener("touchend", handleTouchEnd);
        // Prevent default scroll on touch drag over canvas
        if (canvas) {
            canvas.addEventListener("touchmove", handleTouchDragPreventScroll, {
                passive: false,
            });
        }

        return () => {
            // Cleanup function to cancel the animation frame and remove event listeners
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener("pointermove", handleMouseMove);
            window.removeEventListener("pointerdown", handleMouseDown);
            window.removeEventListener("pointerup", handleMouseUp);
            window.removeEventListener("touchmove", handleTouchMove);
            window.removeEventListener("touchstart", handleTouchStart);
            window.removeEventListener("touchend", handleTouchEnd);
            window.removeEventListener("resize", resizeCanvas);
            window.removeEventListener("popstate", recalculateRect);
            if (canvas) {
                canvas.removeEventListener("touchmove", handleTouchDragPreventScroll);
            }
            particles = [];
        };
    }, [theme.secondary]);

    useEffect(() => {
        visibleUIRef.current = visibleUI;
    }, [visibleUI]);

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
            {visibleUI && (
                <div style={{ zIndex: 3000 }}>
                    <ChangerGroup
                        valueArrays={[
                            {
                                title: "Rune Count:",
                                valueRef: particleCountRef,
                                minValue: "5",
                                maxValue: "100",
                                type: "slider",
                            },
                            {
                                title: "Simulation Speed:",
                                valueRef: simulationSpeedRef,
                                minValue: "1",
                                maxValue: "200.0",
                                type: "slider",
                            },
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
