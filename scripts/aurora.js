function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rgba(color, alpha) {
  return `rgba(${color.join(",")},${clamp(alpha, 0, 1)})`;
}

/**
 * The approved AuroraDrift look: soft mesh-gradient light fields in the
 * upper-right corner. This revision keeps that visual language and adds
 * independent layers instead of turning it into a ray or curtain effect.
 */
export class AuroraDrift {
  constructor(canvas, scene) {
    this.canvas = canvas;
    this.scene = scene;
    this.context = typeof canvas.getContext === "function"
      ? canvas.getContext("2d", { alpha: true, desynchronized: true })
      : null;
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.prefersReducedMotion = this.motionQuery.matches;
    this.lowPower = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
      || (navigator.deviceMemory && navigator.deviceMemory <= 4);
    this.toggle = scene.querySelector("[data-aurora-toggle]");
    this.toggleLabel = scene.querySelector("[data-aurora-toggle-label]");
    this.pausedByUser = this.readPausedState();
    this.visible = true;
    this.running = false;
    this.mobile = false;
    this.animationFrame = null;
    this.lastFrame = 0;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.renderScale = 0.68;
    this.frameInterval = 1000 / 30;
    this.pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this.drawTimes = [];

    this.resize = this.resize.bind(this);
    this.tick = this.tick.bind(this);
    this.handleVisibility = this.handleVisibility.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handleMotionPreference = this.handleMotionPreference.bind(this);
    this.handleToggle = this.handleToggle.bind(this);
  }

  readPausedState() {
    try {
      return window.localStorage.getItem("kurs-na-sever:aurora-paused") === "true";
    } catch {
      return false;
    }
  }

  writePausedState() {
    try {
      window.localStorage.setItem("kurs-na-sever:aurora-paused", String(this.pausedByUser));
    } catch {
      // Keep the preference for this page when storage is unavailable.
    }
  }

  mount() {
    if (this.toggle) {
      this.toggle.addEventListener("click", this.handleToggle);
      this.updateToggle();
    }

    if (!this.context) {
      this.scene.classList.add("is-aurora-unavailable");
      if (this.toggle) {
        this.toggle.hidden = true;
      }
      this.publishDiagnostics(0, "canvas-unavailable");
      return;
    }

    this.scene.classList.add("has-live-aurora");
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(this.scene);
    this.scene.addEventListener("pointermove", this.handlePointerMove, { passive: true });
    this.scene.addEventListener("pointerleave", this.handlePointerLeave, { passive: true });
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.motionQuery.addEventListener("change", this.handleMotionPreference);

    if ("IntersectionObserver" in window) {
      this.intersectionObserver = new IntersectionObserver((entries) => {
        this.visible = entries.some((entry) => entry.isIntersecting);
        if (this.visible) {
          this.start();
        } else {
          this.stop();
        }
      }, { rootMargin: "18% 0px", threshold: 0 });
      this.intersectionObserver.observe(this.scene);
    }

    this.resize();

    if (this.prefersReducedMotion || this.pausedByUser) {
      this.draw(7200);
      return;
    }

    this.start();
  }

  resize() {
    const rect = this.scene.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.mobile = this.width <= 680;
    this.renderScale = this.mobile ? 0.56 : 0.68;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.mobile ? 1.15 : 1.25);

    const targetWidth = Math.round(this.width * this.renderScale * this.dpr);
    const targetHeight = Math.round(this.height * this.renderScale * this.dpr);
    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
    }
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    const maxFps = this.lowPower ? (this.mobile ? 18 : 22) : (this.mobile ? 24 : 30);
    this.frameInterval = 1000 / maxFps;

    if (this.prefersReducedMotion || this.pausedByUser || !this.running) {
      this.draw(7200);
    }
  }

  handlePointerMove(event) {
    if (this.prefersReducedMotion || this.pausedByUser) {
      return;
    }
    const rect = this.scene.getBoundingClientRect();
    this.pointer.targetX = clamp((event.clientX - rect.left) / rect.width - 0.5, -0.5, 0.5);
    this.pointer.targetY = clamp((event.clientY - rect.top) / rect.height - 0.5, -0.5, 0.5);
  }

  handlePointerLeave() {
    this.pointer.targetX = 0;
    this.pointer.targetY = 0;
  }

  handleVisibility() {
    if (document.hidden) {
      this.stop();
    } else {
      this.start();
    }
  }

  handleMotionPreference(event) {
    this.prefersReducedMotion = event.matches;
    this.updateToggle();
    if (this.prefersReducedMotion) {
      this.stop();
      this.draw(7200);
    } else {
      this.start();
    }
  }

  handleToggle() {
    this.pausedByUser = !this.pausedByUser;
    this.writePausedState();
    this.updateToggle();
    if (this.pausedByUser) {
      this.stop();
      this.draw(performance.now());
    } else {
      this.start();
    }
  }

  updateToggle() {
    if (!this.toggle || !this.toggleLabel) {
      return;
    }
    const paused = this.pausedByUser || this.prefersReducedMotion;
    this.toggle.setAttribute("aria-pressed", String(paused));
    this.toggleLabel.textContent = paused ? "Включить сияние" : "Остановить сияние";
    this.scene.classList.toggle("is-aurora-paused", paused);
    this.toggle.disabled = this.prefersReducedMotion;
    this.toggle.title = this.prefersReducedMotion
      ? "Анимация отключена системной настройкой"
      : this.toggleLabel.textContent;
  }

  start() {
    if (
      this.running
      || !this.context
      || this.prefersReducedMotion
      || this.pausedByUser
      || document.hidden
      || !this.visible
    ) {
      return;
    }
    this.running = true;
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  tick(timestamp) {
    if (!this.running) {
      return;
    }
    if (timestamp - this.lastFrame >= this.frameInterval) {
      this.pointer.x += (this.pointer.targetX - this.pointer.x) * 0.032;
      this.pointer.y += (this.pointer.targetY - this.pointer.y) * 0.032;
      this.draw(timestamp);
      this.lastFrame = timestamp;
    }
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  drawBlob(time, {
    color,
    x,
    y,
    radiusX,
    radiusY,
    phase,
    alpha,
    orbitX,
    orbitY,
    speed,
  }) {
    const context = this.context;
    const motion = time * speed + phase;
    const mobileShift = this.mobile ? 0.055 : 0;
    const centerX = this.width * (
      x
      + mobileShift
      + Math.sin(motion) * orbitX
      + this.pointer.x * 0.022
    );
    const centerY = this.height * (
      y
      + Math.cos(motion * 0.84) * orbitY
      + this.pointer.y * 0.018
    );
    const breathing = 1 + Math.sin(motion * 0.71 + phase) * 0.19;
    const shimmer = 0.78 + Math.sin(motion * 1.19 + phase * 0.7) * 0.22;
    const rotation = Math.sin(motion * 0.48 + phase) * 0.2;
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);

    gradient.addColorStop(0, rgba(color, alpha * shimmer));
    gradient.addColorStop(0.25, rgba(color, alpha * 0.82 * shimmer));
    gradient.addColorStop(0.58, rgba(color, alpha * 0.33 * shimmer));
    gradient.addColorStop(0.82, rgba(color, alpha * 0.08 * shimmer));
    gradient.addColorStop(1, rgba(color, 0));

    context.save();
    context.translate(centerX, centerY);
    context.rotate(rotation);
    context.scale(
      this.width * radiusX * breathing,
      this.height * radiusY / breathing,
    );
    context.fillStyle = gradient;
    context.fillRect(-1, -1, 2, 2);
    context.restore();
  }

  getBlobs() {
    return [
      { color: [70, 225, 229], x: 0.68, y: 0.08, radiusX: 0.40, radiusY: 0.27, phase: 0.2, alpha: 0.82, orbitX: 0.074, orbitY: 0.048, speed: 0.00032 },
      { color: [73, 151, 255], x: 0.82, y: 0.19, radiusX: 0.37, radiusY: 0.32, phase: 2.1, alpha: 0.68, orbitX: 0.066, orbitY: 0.058, speed: 0.00027 },
      { color: [222, 91, 220], x: 0.93, y: 0.055, radiusX: 0.31, radiusY: 0.24, phase: 4.4, alpha: 0.64, orbitX: 0.058, orbitY: 0.045, speed: 0.00025 },
      { color: [151, 242, 210], x: 0.61, y: 0.015, radiusX: 0.33, radiusY: 0.20, phase: 5.7, alpha: 0.56, orbitX: 0.067, orbitY: 0.039, speed: 0.00035 },
      { color: [63, 238, 193], x: 0.77, y: 0.005, radiusX: 0.28, radiusY: 0.16, phase: 1.25, alpha: 0.48, orbitX: 0.082, orbitY: 0.032, speed: 0.0004 },
      { color: [74, 212, 255], x: 0.55, y: 0.14, radiusX: 0.30, radiusY: 0.22, phase: 3.35, alpha: 0.44, orbitX: 0.07, orbitY: 0.052, speed: 0.0003 },
      { color: [151, 132, 255], x: 0.86, y: 0.27, radiusX: 0.30, radiusY: 0.22, phase: 5.05, alpha: 0.46, orbitX: 0.061, orbitY: 0.062, speed: 0.00023 },
      { color: [247, 139, 213], x: 1.01, y: 0.16, radiusX: 0.26, radiusY: 0.19, phase: 0.85, alpha: 0.42, orbitX: 0.064, orbitY: 0.048, speed: 0.00029 },
    ];
  }

  publishDiagnostics(drawDuration, fallbackReason = null) {
    this.drawTimes.push(drawDuration);
    if (this.drawTimes.length > 90) {
      this.drawTimes.shift();
    }
    const sorted = [...this.drawTimes].sort((a, b) => a - b);
    const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    window.__auroraDiagnostics = {
      renderer: this.context ? "canvas-drift-v7" : "unavailable",
      running: this.running,
      reducedMotion: this.prefersReducedMotion,
      pausedByUser: this.pausedByUser,
      renderScale: this.renderScale,
      layers: 8,
      drawMsP95: sorted[p95Index] || 0,
      fallbackReason,
    };
  }

  draw(time) {
    const context = this.context;
    if (!context || !this.width || !this.height) {
      return;
    }
    const startedAt = performance.now();
    const scale = this.renderScale * this.dpr;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    context.save();
    context.globalCompositeOperation = "screen";
    this.getBlobs().forEach((blob) => this.drawBlob(time, blob));
    context.restore();
    this.publishDiagnostics(performance.now() - startedAt);
  }
}

export function initAurora() {
  const canvas = document.querySelector("[data-aurora-canvas]");
  const scene = document.querySelector("[data-hero-scene]");
  if (!canvas || !scene) {
    return null;
  }
  const aurora = new AuroraDrift(canvas, scene);
  aurora.mount();
  return aurora;
}
