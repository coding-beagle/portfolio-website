import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { IconGroup } from "../utilities/popovers";
import { ChangerGroup } from "../utilities/valueChangers";
import { clamp, distanceBetweenTwoPoints, ElementCollisionHitbox, getCloseColour, getRandomColour, scaleColour } from "../utilities/usefulFunctions";
import { FireworkChaff } from "./firework";

export default function Runes({ visibleUI }) {
    const { theme } = useTheme();
    const canvasRef = useRef(null);

    const themeRef = useRef(theme);
    const mousePosRef = useRef({ x: 0, y: 0 });
    const mouseClickRef = useRef(false);

    const particleCountRef = useRef(10);
    const bloomEffectRef = useRef(6);
    const simulationSpeedRef = useRef(100);
    const mouseShieldRadiusRef = useRef(100);
    const titleShieldRadiusRef = useRef(30);
    const recalculateRectRef = useRef(() => { });
    const visibleUIRef = useRef(visibleUI);
    const [, setRender] = useState(0); // Dummy state to force re-render

    useEffect(() => {

        let particles = [];
        let animationFrameId;

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
        const minDistanceBetweenPoints = 50;
        const minDistanceBetweenRunes = 200;
        const maxPoints = 10;
        const minPoints = 4;
        const maxChargeCount = 150;
        const maxActiveCount = 500;
        const shatterCount = 200;
        const postShatterLife = 1000;
        const gravity = 0.05;
        class Rune {
            constructor(x, y) {
                this.x = x;
                this.y = y;
                this.vx = 0;
                this.vy = 0;
                this.points = this.populatePoints(clamp(Math.round(Math.random() * 10), minPoints, maxPoints))
                this.closedRune = Math.random() > 0.5;
                this.color = getRandomColour();
                this.charging = false;
                this.chargeCount = 0;
                this.active = false;
                this.activeCount = 0;
                this.hoveredWhileActive = 0;
                this.shattered = false;
                this.shatteredCount = 0;

                this.childParticles = [];
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
                    if (this.chargeCount < maxChargeCount) {
                        this.chargeCount += 1;
                    } else {
                        if (this.hoveredWhileActive < shatterCount) {
                            this.hoveredWhileActive++;
                        } else {
                            this.createChildParticles();
                            this.shattered = true;
                        }
                        this.activeCount = maxActiveCount;
                    }
                } else if (this.chargeCount > 0 && !this.active) {
                    this.chargeCount -= 2;
                } else if (this.activeCount > 0 && this.active) {
                    this.activeCount -= 2;
                } else if (this.hoveredWhileActive > 0 && this.active) {
                    this.hoveredWhileActive--;
                }

                this.charging = this.chargeCount !== 0;
                this.active = this.activeCount !== 0;

                this.vx = ((Math.random() - 0.5) * 2) * this.chargeCount / maxChargeCount;
                this.vy = ((Math.random() - 0.5) * 2) * this.chargeCount / maxChargeCount;

                this.x += this.vx * simulationSpeedRef.current / 100;
                this.y += this.vy * simulationSpeedRef.current / 100;

                if (this.shattered) {
                    this.shatteredCount++
                    this.childParticles.forEach((particle) => particle.update(simulationSpeedRef))
                }
            }

            createChildParticles() {
                if (this.shattered) {
                    return
                }
                const chaffCount = Math.floor(Math.random() * 20) + 5;
                const angleStep = (Math.PI * 2) / chaffCount;
                const colour = getCloseColour(this.color);
                for (let i = 0; i < chaffCount; i++) {
                    const angle = i * angleStep;
                    const speed = Math.random() * 2 + 1;
                    const vx = Math.cos(angle) * speed;
                    const vy = Math.sin(angle) * speed;
                    const initialSize = Math.random() * 20 + 5;
                    const sizeFallOff = Math.random() * 0.05 + 0.01;
                    this.childParticles.push(
                        new FireworkChaff(
                            this.x,
                            this.y,
                            vx,
                            vy,
                            colour,
                            initialSize,
                            sizeFallOff,
                            gravity
                        )
                    );
                }
            }

            draw() {
                if (!this.shattered) {
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

                    }

                    if (this.closedRune) {
                        ctx.closePath()
                    }

                    ctx.strokeStyle = this.charging ? scaleColour(themeRef.current.accent, this.color, this.chargeCount / maxChargeCount) : themeRef.current.accent;
                    ctx.lineWidth = 10
                    if (this.active) {
                        ctx.shadowColor = this.color
                        ctx.shadowBlur = Math.round((this.activeCount / maxActiveCount) * bloomEffectRef.current); // Glow effect
                    } else {
                        ctx.shadowBlur = 0
                    }

                    ctx.stroke()
                } else {
                    this.childParticles.forEach((particle) => {
                        particle.draw(ctx, true, bloomEffectRef)
                    })
                }
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

            particles = particles.filter(particle =>
                !(particle.shattered && particle.shatteredCount > postShatterLife)
            );

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
    }, []);

    useEffect(() => {
        visibleUIRef.current = visibleUI;
    }, [visibleUI]);

    useEffect(() => {
        themeRef.current = theme;
    }, [theme])

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
                            {
                                title: "Glow Radius:",
                                valueRef: bloomEffectRef,
                                minValue: "1",
                                maxValue: "24.0",
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
