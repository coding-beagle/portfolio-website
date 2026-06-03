import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "../../../../themes/ThemeProvider";
import { colourRGBtoColourRGBA } from "./usefulFunctions";

export function VirtualJoypad({
    controls,
    size,
    style,
    onChange,
    onRelease,
    knobOffsetX = 0,
    knobOffsetY = 0,
}) {
    const { theme } = useTheme();
    const joypadRef = useRef(null);
    const dragStateRef = useRef({ active: false, touchId: null });
    const [knobPosition, setKnobPosition] = useState({
        x: knobOffsetX,
        y: knobOffsetY,
    });

    const knobSize =
        typeof size === "number" ? size * 0.6 : `calc(${size} * 0.6)`;

    useEffect(() => {
        if (dragStateRef.current.active) return;

        setKnobPosition({ x: knobOffsetX, y: knobOffsetY });
    }, [knobOffsetX, knobOffsetY]);

    const emitPosition = useCallback(
        (x, y, maxOffset) => {
            const normalizedX = maxOffset > 0 ? x / maxOffset : 0;
            const normalizedY = maxOffset > 0 ? y / maxOffset : 0;

            setKnobPosition({ x, y });

            if (onChange) {
                onChange({
                    x,
                    y,
                    normalizedX,
                    normalizedY,
                    magnitude: Math.min(
                        1,
                        Math.hypot(normalizedX, normalizedY)
                    ),
                });
            }
        },
        [onChange]
    );

    const updateFromPoint = useCallback(
        (clientX, clientY) => {
            const joypad = joypadRef.current;

            if (!joypad) return;

            const rect = joypad.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const maxOffset = Math.max(0, (rect.width - rect.width * 0.6) / 2);

            let dx = clientX - centerX;
            let dy = clientY - centerY;

            const distance = Math.hypot(dx, dy);

            if (distance > maxOffset && distance > 0) {
                const scale = maxOffset / distance;
                dx *= scale;
                dy *= scale;
            }

            emitPosition(dx, dy, maxOffset);
        },
        [emitPosition]
    );

    const resetKnob = useCallback(() => {
        dragStateRef.current = { active: false, touchId: null };
        setKnobPosition({ x: 0, y: 0 });

        if (onRelease) {
            onRelease();
        }

        if (onChange) {
            onChange({
                x: 0,
                y: 0,
                normalizedX: 0,
                normalizedY: 0,
                magnitude: 0,
            });
        }
    }, [onChange, onRelease]);

    useEffect(() => {
        const handleMouseMove = (event) => {
            if (!dragStateRef.current.active) return;
            updateFromPoint(event.clientX, event.clientY);
        };

        const handleMouseUp = () => {
            if (!dragStateRef.current.active) return;
            resetKnob();
        };

        const handleTouchMove = (event) => {
            if (!dragStateRef.current.active) return;

            const activeTouch = Array.from(event.touches).find(
                (touch) => touch.identifier === dragStateRef.current.touchId
            );

            if (!activeTouch) return;

            if (event.cancelable) {
                event.preventDefault();
            }

            updateFromPoint(activeTouch.clientX, activeTouch.clientY);
        };

        const handleTouchEnd = (event) => {
            if (!dragStateRef.current.active) return;

            const stillActive = Array.from(event.touches).some(
                (touch) => touch.identifier === dragStateRef.current.touchId
            );

            if (!stillActive) {
                resetKnob();
            }
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        window.addEventListener("touchmove", handleTouchMove, { passive: false });
        window.addEventListener("touchend", handleTouchEnd);
        window.addEventListener("touchcancel", handleTouchEnd);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
            window.removeEventListener("touchmove", handleTouchMove);
            window.removeEventListener("touchend", handleTouchEnd);
            window.removeEventListener("touchcancel", handleTouchEnd);
        };
    }, [resetKnob, updateFromPoint]);

    const handleMouseDown = (event) => {
        dragStateRef.current = { active: true, touchId: null };
        updateFromPoint(event.clientX, event.clientY);
    };

    const handleTouchStart = (event) => {
        const touch = event.changedTouches[0];

        if (!touch) return;

        dragStateRef.current = { active: true, touchId: touch.identifier };

        if (event.cancelable) {
            event.preventDefault();
        }

        updateFromPoint(touch.clientX, touch.clientY);
    };

    return (
        <div
            ref={joypadRef}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            style={{
                position: "relative",
                overflow: "hidden",
                borderRadius: "50%",
                width: size,
                height: size,
                backgroundColor: colourRGBtoColourRGBA(theme.accent, 150),
                touchAction: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
                WebkitTapHighlightColor: "transparent",
                ...style,
            }}
        >
            <div
                style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    transform: `translate(-50%, -50%) translate(${knobPosition.x}px, ${knobPosition.y}px)`,
                    width: knobSize,
                    height: knobSize,
                    borderRadius: "50%",
                    backgroundColor: colourRGBtoColourRGBA(theme.primary, 150),
                    pointerEvents: "none",
                }}
            />
        </div>
    );
}