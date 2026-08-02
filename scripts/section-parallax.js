const SECTION_SELECTOR = "[data-parallax-section]";
const LAYER_SELECTOR = "[data-parallax-layer]";
const FRAME_INTERVAL = 1000 / 30;
const DEFAULT_RANGE = 44;
const DEFAULT_POINTER_RANGE = 10;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function numberFrom(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mediaQuery(query) {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(query)
    : { matches: false, addEventListener() {}, removeEventListener() {} };
}

/**
 * Progressive-enhancement parallax for decorative section backgrounds.
 *
 * Data API:
 * - section: data-parallax-range="44" data-parallax-pointer="10"
 * - layer: data-parallax-depth=".6" data-parallax-x=".2"
 *          data-parallax-y="1" data-parallax-rotate=".8"
 *          data-parallax-scale=".012"
 *
 * The module writes only CSS custom properties. Layout and artwork remain CSS/HTML concerns.
 */
export function initSectionParallax(root = document) {
  const sections = Array.from(root.querySelectorAll(SECTION_SELECTOR))
    .filter((section) => section.querySelector(LAYER_SELECTOR))
    .filter((section) => section.dataset.parallaxReady !== "true");

  if (!sections.length) {
    return () => {};
  }

  const reducedMotion = mediaQuery("(prefers-reduced-motion: reduce)");
  const mobileLayout = mediaQuery("(max-width: 767px), (pointer: coarse)");
  const saveData = navigator.connection?.saveData === true;
  const limitedMemory = Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory <= 4;
  const limitedCpu = Number.isFinite(navigator.hardwareConcurrency) && navigator.hardwareConcurrency <= 4;

  const pointer = {
    currentX: 0,
    currentY: 0,
    targetX: 0,
    targetY: 0,
  };

  const states = sections.map((section) => {
    section.dataset.parallaxReady = "true";

    const visual = section.querySelector(".section-parallax");
    visual?.setAttribute("aria-hidden", "true");

    const layers = Array.from(section.querySelectorAll(LAYER_SELECTOR)).map((layer, index, all) => {
      const naturalDepth = (index + 1) / Math.max(all.length, 1);

      return {
        element: layer,
        depth: clamp(numberFrom(layer.dataset.parallaxDepth, naturalDepth), -2, 2),
        xFactor: clamp(numberFrom(layer.dataset.parallaxX, 0.18), -2, 2),
        yFactor: clamp(numberFrom(layer.dataset.parallaxY, 1), -2, 2),
        rotateFactor: clamp(numberFrom(layer.dataset.parallaxRotate, 0.65), -8, 8),
        scaleFactor: clamp(numberFrom(layer.dataset.parallaxScale, 0.01), 0, 0.08),
      };
    });

    return {
      section,
      layers,
      active: false,
      range: clamp(numberFrom(section.dataset.parallaxRange, DEFAULT_RANGE), 0, 120),
      pointerRange: clamp(numberFrom(section.dataset.parallaxPointer, DEFAULT_POINTER_RANGE), 0, 28),
    };
  });

  let lowPowerMode = false;
  let frame = 0;
  let lastRender = 0;
  let needsRender = true;
  let destroyed = false;

  const applyStaticState = (state) => {
    state.section.dataset.parallaxMode = "static";
    state.layers.forEach(({ element }) => {
      element.style.setProperty("--parallax-x", "0px");
      element.style.setProperty("--parallax-y", "0px");
      element.style.setProperty("--parallax-rotate", "0deg");
      element.style.setProperty("--parallax-scale", "1");
    });
  };

  const updateMode = () => {
    lowPowerMode = reducedMotion.matches
      || mobileLayout.matches
      || saveData
      || limitedMemory
      || limitedCpu;

    states.forEach((state) => {
      if (lowPowerMode) {
        applyStaticState(state);
      } else {
        state.section.dataset.parallaxMode = "active";
      }
    });

    needsRender = !lowPowerMode;
    if (lowPowerMode && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }

    if (!lowPowerMode) {
      schedule();
    }
  };

  const renderState = (state) => {
    const rect = state.section.getBoundingClientRect();
    const travel = (window.innerHeight + rect.height) * 0.5;
    const sectionCenter = rect.top + rect.height * 0.5;
    const viewportCenter = window.innerHeight * 0.5;
    const progress = clamp((sectionCenter - viewportCenter) / Math.max(travel, 1), -1, 1);

    state.layers.forEach((layer) => {
      const scrollTravel = progress * state.range * layer.depth;
      const pointerX = pointer.currentX * state.pointerRange * layer.depth;
      const pointerY = pointer.currentY * state.pointerRange * layer.depth;
      const x = scrollTravel * layer.xFactor + pointerX;
      const y = scrollTravel * layer.yFactor + pointerY * 0.55;
      const rotation = progress * layer.rotateFactor * layer.depth
        + pointer.currentX * layer.rotateFactor * 0.28;
      const scale = 1 + Math.abs(progress) * layer.scaleFactor * Math.abs(layer.depth);

      layer.element.style.setProperty("--parallax-x", `${x.toFixed(2)}px`);
      layer.element.style.setProperty("--parallax-y", `${y.toFixed(2)}px`);
      layer.element.style.setProperty("--parallax-rotate", `${rotation.toFixed(3)}deg`);
      layer.element.style.setProperty("--parallax-scale", scale.toFixed(4));
    });
  };

  const schedule = () => {
    if (destroyed || lowPowerMode || document.hidden || frame) {
      return;
    }
    frame = requestAnimationFrame(render);
  };

  const render = (timestamp) => {
    frame = 0;

    if (timestamp - lastRender < FRAME_INTERVAL) {
      schedule();
      return;
    }

    lastRender = timestamp;
    pointer.currentX += (pointer.targetX - pointer.currentX) * 0.14;
    pointer.currentY += (pointer.targetY - pointer.currentY) * 0.14;

    states.forEach((state) => {
      if (state.active) {
        renderState(state);
      }
    });

    const pointerSettling = Math.abs(pointer.targetX - pointer.currentX) > 0.002
      || Math.abs(pointer.targetY - pointer.currentY) > 0.002;

    needsRender = false;
    if (pointerSettling) {
      schedule();
    }
  };

  const requestRender = () => {
    needsRender = true;
    schedule();
  };

  const onPointerMove = (event) => {
    pointer.targetX = clamp((event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2, -1, 1);
    pointer.targetY = clamp((event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2, -1, 1);
    requestRender();
  };

  const onPointerLeave = () => {
    pointer.targetX = 0;
    pointer.targetY = 0;
    requestRender();
  };

  const onVisibilityChange = () => {
    if (!document.hidden && needsRender) {
      schedule();
    }
  };

  let observer = null;
  if ("IntersectionObserver" in window) {
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const state = states.find(({ section }) => section === entry.target);
        if (!state) {
          return;
        }
        state.active = entry.isIntersecting;
        state.section.classList.toggle("is-parallax-active", entry.isIntersecting);
      });
      requestRender();
    }, { rootMargin: "18% 0px", threshold: 0 });

    states.forEach(({ section }) => observer.observe(section));
  } else {
    states.forEach((state) => {
      state.active = true;
      state.section.classList.add("is-parallax-active");
    });
  }

  updateMode();

  window.addEventListener("scroll", requestRender, { passive: true });
  window.addEventListener("resize", requestRender, { passive: true });
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.documentElement.addEventListener("pointerleave", onPointerLeave, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  reducedMotion.addEventListener("change", updateMode);
  mobileLayout.addEventListener("change", updateMode);
  requestRender();

  return () => {
    destroyed = true;
    observer?.disconnect();
    if (frame) {
      cancelAnimationFrame(frame);
    }

    window.removeEventListener("scroll", requestRender);
    window.removeEventListener("resize", requestRender);
    window.removeEventListener("pointermove", onPointerMove);
    document.documentElement.removeEventListener("pointerleave", onPointerLeave);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    reducedMotion.removeEventListener("change", updateMode);
    mobileLayout.removeEventListener("change", updateMode);

    states.forEach(({ section, layers }) => {
      delete section.dataset.parallaxReady;
      delete section.dataset.parallaxMode;
      section.classList.remove("is-parallax-active");
      layers.forEach(({ element }) => {
        element.style.removeProperty("--parallax-x");
        element.style.removeProperty("--parallax-y");
        element.style.removeProperty("--parallax-rotate");
        element.style.removeProperty("--parallax-scale");
      });
    });
  };
}

let autoCleanup = null;

function autoInit() {
  autoCleanup = initSectionParallax();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", autoInit, { once: true });
} else {
  autoInit();
}

export function destroySectionParallax() {
  autoCleanup?.();
  autoCleanup = null;
}
