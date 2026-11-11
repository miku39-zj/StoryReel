"use client";

import { Background, useViewport } from "@xyflow/react";

/** Screen-sized dots remain visible when zooming out to large story graphs. */
export function CanvasBackground() {
  const { zoom } = useViewport();
  const gap = 24 / zoom,
    size = 2 / zoom;
  return (
    <>
      <Background id="canvas-dots" color="#454549" gap={gap} size={size} />
      <Background
        id="canvas-highlight"
        className="canvas-particle-highlight"
        style={{ background: "transparent" }}
        bgColor="transparent"
        color="#c4edfa"
        gap={gap}
        size={size + 0.5 / zoom}
      />
    </>
  );
}
