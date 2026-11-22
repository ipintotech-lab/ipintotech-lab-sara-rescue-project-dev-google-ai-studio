import React, { useEffect, useRef } from 'react';
import { clamp } from '../sim/engine';
import type { Camera3D } from '../sim/renderers';

interface Canvas3DViewProps {
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, cam: Camera3D) => void;
  autoRotate?: boolean;
  resetKey?: string;
  deps?: unknown[];
  className?: string;
}

export function Canvas3DView({
  draw,
  autoRotate = false,
  resetKey,
  deps = [],
  className = '',
}: Canvas3DViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const camRef = useRef<Camera3D>({ yaw: 0.75, pitch: 0.62, zoom: 1, dirty: true });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    camRef.current.g = undefined;
    camRef.current.dirty = true;
  }, [resetKey]);

  useEffect(() => {
    camRef.current.dirty = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (autoRotate) {
        camRef.current.yaw += dt * 0.35;
        camRef.current.dirty = true;
      }
      const cv = canvasRef.current;
      if (cv && camRef.current.dirty) {
        const rect = cv.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const dp = window.devicePixelRatio || 1;
          const tw = Math.round(rect.width * dp);
          const th = Math.round(rect.height * dp);
          if (cv.width !== tw || cv.height !== th) {
            cv.width = tw;
            cv.height = th;
          }
          const ctx = cv.getContext('2d');
          if (ctx) {
            ctx.setTransform(dp, 0, 0, dp, 0, 0);
            ctx.clearRect(0, 0, rect.width, rect.height);
            drawRef.current(ctx, rect.width, rect.height, camRef.current);
            camRef.current.dirty = false;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      camRef.current.dirty = true;
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [autoRotate]);

  return (
    <canvas
      ref={canvasRef}
      className={`block w-full h-full touch-none select-none cursor-grab active:cursor-grabbing ${className}`}
      onPointerDown={(e) => {
        dragRef.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return;
        camRef.current.yaw += (e.clientX - dragRef.current.x) * 0.01;
        camRef.current.pitch = clamp(
          camRef.current.pitch + (e.clientY - dragRef.current.y) * 0.01,
          0.08,
          1.5
        );
        dragRef.current = { x: e.clientX, y: e.clientY };
        camRef.current.dirty = true;
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
      onWheel={(e) => {
        e.preventDefault();
        camRef.current.zoom = clamp(
          camRef.current.zoom * Math.exp(-e.deltaY * 0.0012),
          0.4,
          5
        );
        camRef.current.dirty = true;
      }}
    />
  );
}
