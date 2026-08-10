"use client";

import { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  radius: number;
  baseAlpha: number;
  speed: number;
  phase: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

export function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let raf = 0;
    let nextMeteorAt = performance.now() + 4000;

    const stars: Star[] = [];
    const meteors: Meteor[] = [];

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      spawnStars();
    };

    const spawnStars = () => {
      stars.length = 0;
      const count = Math.min(260, Math.floor((width * height) / 8000));
      for (let i = 0; i < count; i += 1) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: Math.random() * 1.1 + 0.3,
          baseAlpha: Math.random() * 0.5 + 0.25,
          speed: Math.random() * 1.4 + 0.4,
          phase: Math.random() * Math.PI * 2,
        });
      }
    };

    const drawStars = (t: number) => {
      for (const star of stars) {
        const alpha =
          star.baseAlpha *
          (0.5 + 0.5 * Math.sin((t / 1000) * star.speed + star.phase));
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(226, 232, 255, ${alpha.toFixed(3)})`;
        ctx.fill();
      }
    };

    const drawMeteors = () => {
      for (let i = meteors.length - 1; i >= 0; i -= 1) {
        const meteor = meteors[i];
        meteor.x += meteor.vx;
        meteor.y += meteor.vy;
        meteor.life -= 1;

        if (meteor.life <= 0) {
          meteors.splice(i, 1);
          continue;
        }

        const tail = meteor.maxLife * 0.6;
        const gradient = ctx.createLinearGradient(
          meteor.x,
          meteor.y,
          meteor.x - meteor.vx * tail,
          meteor.y - meteor.vy * tail,
        );
        gradient.addColorStop(0, "rgba(255, 255, 255, 0.9)");
        gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(meteor.x, meteor.y);
        ctx.lineTo(
          meteor.x - meteor.vx * tail,
          meteor.y - meteor.vy * tail,
        );
        ctx.stroke();
      }
    };

    const spawnMeteor = () => {
      const fromLeft = Math.random() > 0.5;
      const speed = 7 + Math.random() * 5;
      meteors.push({
        x: fromLeft ? -20 : width + 20,
        y: Math.random() * height * 0.4,
        vx: (fromLeft ? 1 : -1) * speed * 0.7,
        vy: speed,
        life: 90,
        maxLife: 90,
      });
    };

    const frame = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      drawStars(t);
      drawMeteors();

      if (t > nextMeteorAt) {
        spawnMeteor();
        nextMeteorAt = t + 7000 + Math.random() * 9000;
      }

      raf = requestAnimationFrame(frame);
    };

    resize();
    raf = requestAnimationFrame(frame);

    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
    />
  );
}
