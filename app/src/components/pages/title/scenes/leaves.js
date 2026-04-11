import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { ChangerGroup } from "../utilities/valueChangers";
import { getCloseColour, randomFloatBetweenTwo, scaleColour } from "../utilities/usefulFunctions";

export default function Leaves({ visibleUI }) {
    const { theme } = useTheme();
    const canvasRef = useRef(null);
    const particleCountRef = useRef(50);
    const simulationSpeedRef = useRef(100);
    const themeRef = useRef(theme);
    const autumnalRef = useRef(0);
    const [, setRender] = useState(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        // const titleShieldRadius = 30;

        const resizeCanvas = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            // recalculateRect();
        };
        resizeCanvas();
        window.addEventListener("resize", resizeCanvas);
        const ctx = canvas.getContext("2d");

        let particles = [];
        const gravity = 0.05;
        const maxLateralSpeed = 0.2;
        const maxSpeed = 0.01;
        let animationFrameId;
        let windSpeed = 0;

        const getSway = (phase) => {
            return Math.random() * Math.sin(phase / 80) + 0.2 * Math.sin(phase / 30) + 0.1 * Math.sin(phase / 13)
        }

        class Particle {
            constructor(x, y) {
                this.x = x;
                this.y = y;
                this.vx = 0.1 * (Math.random() * 2 - 1) + 0.2 * windSpeed;
                this.vy = Math.random() * 2 - 1;
                this.size = Math.random() * 10 + 3;
                this.normalColor = getCloseColour(themeRef.current.secondaryAccent, 40, 40, 40);
                this.autumnalColour = getCloseColour(themeRef.current.tertiaryAccent, 40, 40, 40);
                this.swayPhase = Math.round(Math.random() * 1000)
            }

            reset() {
                this.normalColor = getCloseColour(themeRef.current.secondaryAccent, 40, 40, 40);
                this.autumnalColour = getCloseColour(themeRef.current.tertiaryAccent, 40, 40, 40);
                if (gravity > 0.0) {
                    if (Math.random() > 0.5) {
                        this.y = 0;
                        this.x = Math.random() * canvas.width;
                    } else {
                        this.y = Math.random() * canvas.height;
                        this.x = Math.random() > 0.5 ? 0 : canvas.width;
                    }
                    this.vy *= -0.5;
                    this.vx = 0.1 * (Math.random() * 2 - 1) + 0.2 * windSpeed;
                } else {
                    if (Math.random() > 0.5) {
                        this.y = canvas.height;
                        this.x = Math.random() * canvas.width;
                    } else {
                        this.y = Math.random() * canvas.height;
                        this.x = Math.random() > 0.5 ? 0 : canvas.width;
                    }
                    this.vx = 0.1 * (Math.random() * 2 - 1) + 0.2 * windSpeed;
                }
            }

            update() {
                this.color = scaleColour(this.normalColor, this.autumnalColour, autumnalRef.current / 100);
                this.vy += gravity;
                this.vx += windSpeed * Math.random()
                this.swayPhase += 1;
                this.x += ((this.vx + getSway(this.swayPhase)) * simulationSpeedRef.current) / 100;
                this.y += (this.vy * simulationSpeedRef.current) / 100;

                if (this.y + this.size > canvas.height && gravity > 0.0) {
                    this.reset();
                }

                if (this.y + this.size < 0.0 && gravity < 0.0) {
                    this.reset();
                }

                if (Math.abs(this.vy) > maxSpeed) {
                    this.vy *= 0.9;
                }

                if (Math.abs(this.vy) < maxSpeed) {
                    this.vy += randomFloatBetweenTwo(0.01, 0.5) * Math.sign(gravity);
                }

                if (Math.abs(this.vx) > maxLateralSpeed * this.size) {
                    this.vx *= 0.9;
                } else if (Math.abs(this.vx) < maxLateralSpeed * this.size) {
                    this.vx += randomFloatBetweenTwo(0.01, Math.abs(windSpeed)) * Math.sign(windTarget);
                }

                if (this.x - this.size > canvas.width || this.x + this.size < 0) {
                    this.reset();
                }
            }

            draw() {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fillStyle = this.color;
                ctx.fill();
                ctx.closePath();
            }
        }

        function initParticles() {
            for (let i = 0; i < particleCountRef.current; i++) {
                const x = Math.random() * canvas.width;
                const y = Math.random() * canvas.height;
                particles.push(new Particle(x, y));
            }
        }

        const maxWindSpeed = 0.1;
        const minWindSpeed = -0.1;
        const maxWindTargetCount = 200;

        let windTargetCount;

        const newWindTargetCount = () => {
            windCount = 0;
            windTargetCount = Math.round(randomFloatBetweenTwo(0, maxWindTargetCount));
            windTarget = randomFloatBetweenTwo(maxWindSpeed, minWindSpeed);
            console.log(`New windTarget = ${windTarget}`)
        }

        let windCount = 0;
        let windTarget = randomFloatBetweenTwo(maxWindSpeed, minWindSpeed)

        newWindTargetCount()

        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            windSpeed = windTarget * 0.001 + windSpeed * 0.999;
            windCount++;
            if (windCount > windTargetCount) {
                newWindTargetCount()
            }

            // Adjust particle count
            const currentParticleCount = particles.length;
            if (currentParticleCount < particleCountRef.current) {
                for (let i = currentParticleCount; i < particleCountRef.current; i++) {
                    const x = Math.random() * canvas.width;
                    const y = Math.random() * canvas.height;
                    particles.push(new Particle(x, y));
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

        // Attach particles array to canvas for theme effect access
        canvas._particles = particles;

        return () => {
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener("resize", resizeCanvas);
            particles = [];
        };
    }, []);

    // Update colorRef and all particles' colors on theme change
    useEffect(() => {
        // colorRef.current = theme.secondaryAccent;
        // Update all existing particles' colors
        const canvas = canvasRef.current;
        if (!canvas) return;
        themeRef.current = theme;
    }, [theme]);

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
                                title: "Particle Count:",
                                valueRef: particleCountRef,
                                minValue: "10",
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
                                title: "Autumn Percentage:",
                                valueRef: autumnalRef,
                                minValue: "0",
                                maxValue: "100.0",
                                type: "slider",
                            },
                        ]}
                        rerenderSetter={setRender}
                    />
                </div>
            )}
        </>
    );
}
