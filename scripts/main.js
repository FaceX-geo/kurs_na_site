import ApiClient, { ApiError } from "./api-client.js";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const staticSpheres = [
  { value: "education", label: "Образование" },
  { value: "medicine", label: "Медицина" },
  { value: "engineering", label: "Техническая специальность" },
  { value: "civil", label: "Гражданская служба" },
  { value: "government", label: "Государственная служба" },
  { value: "military", label: "Военная служба" },
];

const state = {
  activeModal: null,
  currentStep: 1,
  isSubmitting: false,
  resumeFileId: null,
};

const apiClient = new ApiClient({
  baseUrl: "/api/v1",
  maxRetries: 2,
  retryDelayMs: 350,
});

function qs(selector, context = document) {
  return context.querySelector(selector);
}

function qsa(selector, context = document) {
  return Array.from(context.querySelectorAll(selector));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getHeaderOffset() {
  const header = qs(".site-header");
  return header ? header.offsetHeight + 12 : 12;
}

function getFocusable(container) {
  return qsa(FOCUSABLE_SELECTOR, container).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function trapTabKey(event, container) {
  if (event.key !== "Tab") {
    return;
  }

  const focusable = getFocusable(container);
  if (!focusable.length) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function initMobileMenu() {
  const menu = qs("#mobile-menu");
  const menuToggle = qs("#menu-toggle");
  const closeBtn = qs("#menu-close");
  const overlay = qs("#menu-overlay");
  const links = qsa("#mobile-menu a[data-anchor]");

  if (!menu || !menuToggle || !closeBtn || !overlay) {
    return;
  }

  const openMenu = () => {
    menu.setAttribute("aria-hidden", "false");
    menuToggle.setAttribute("aria-expanded", "true");
    document.body.classList.add("menu-open");
    const firstLink = qs("a[data-anchor]", menu);
    if (firstLink) {
      firstLink.focus();
    }
  };

  const closeMenu = () => {
    menu.setAttribute("aria-hidden", "true");
    menuToggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("menu-open");
    menuToggle.focus();
  };

  menuToggle.addEventListener("click", openMenu);
  closeBtn.addEventListener("click", closeMenu);
  overlay.addEventListener("click", closeMenu);

  links.forEach((link) => {
    link.addEventListener("click", () => {
      closeMenu();
    });
  });

  menu.addEventListener("keydown", (event) => {
    if (menu.getAttribute("aria-hidden") === "true") {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }

    trapTabKey(event, qs(".mobile-menu__panel", menu));
  });
}

function initSmoothAnchors() {
  const links = qsa("a[data-anchor]");

  links.forEach((link) => {
    link.addEventListener("click", (event) => {
      const targetSelector = link.getAttribute("href");
      if (!targetSelector || !targetSelector.startsWith("#")) {
        return;
      }

      const target = qs(targetSelector);
      if (!target) {
        return;
      }

      event.preventDefault();
      const targetTop = target.getBoundingClientRect().top + window.pageYOffset - getHeaderOffset();
      window.scrollTo({ top: targetTop, behavior: "smooth" });
    });
  });
}

function initRevealAnimations() {
  const nodes = qsa(".reveal");
  if (!nodes.length) {
    return;
  }

  if (!("IntersectionObserver" in window)) {
    nodes.forEach((node) => node.classList.add("is-visible"));
    return;
  }

  nodes.forEach((node) => node.classList.add("is-pending"));

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }
      entry.target.classList.add("is-visible");
      obs.unobserve(entry.target);
    });
  }, { threshold: 0.2, rootMargin: "0px 0px -6% 0px" });

  nodes.forEach((node) => observer.observe(node));
}

function initParallaxScenes() {
  const sceneNodes = qsa("[data-parallax-scene]");
  if (!sceneNodes.length) {
    return;
  }

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const rootStyles = window.getComputedStyle(document.documentElement);
  const fallbackHeroMax = toNumber(rootStyles.getPropertyValue("--parallax-max-hero"), 28);
  const fallbackSectionMax = toNumber(rootStyles.getPropertyValue("--parallax-max-section"), 14);
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const allowPointer = !prefersReducedMotion && !window.matchMedia("(pointer: coarse)").matches;

  const scenes = sceneNodes.map((sceneNode) => {
    const layers = qsa("[data-parallax-layer]", sceneNode)
      .map((layerNode) => ({
        node: layerNode,
        depth: toNumber(layerNode.getAttribute("data-depth"), 0),
      }))
      .filter((layer) => layer.depth !== 0);

    if (!layers.length) {
      return null;
    }

    const fallbackMax = sceneNode.classList.contains("hero__frame") ? fallbackHeroMax : fallbackSectionMax;
    return {
      node: sceneNode,
      layers,
      maxShift: toNumber(sceneNode.getAttribute("data-parallax-max"), fallbackMax),
      pointerX: 0,
      pointerY: 0,
    };
  }).filter(Boolean);

  if (!scenes.length) {
    return;
  }

  const activeScenes = new Set(scenes);
  const sceneByNode = new Map(scenes.map((scene) => [scene.node, scene]));
  let queued = false;

  if ("IntersectionObserver" in window) {
    activeScenes.clear();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const scene = sceneByNode.get(entry.target);
        if (!scene) {
          return;
        }
        if (entry.isIntersecting) {
          activeScenes.add(scene);
        } else {
          activeScenes.delete(scene);
        }
      });
    }, { threshold: 0, rootMargin: "20% 0px 20% 0px" });

    scenes.forEach((scene) => observer.observe(scene.node));
  }

  const renderScene = (scene) => {
    const rect = scene.node.getBoundingClientRect();
    const viewportHeight = window.innerHeight || 1;
    const viewportCenter = viewportHeight / 2;
    const sceneCenter = rect.top + rect.height / 2;
    const scrollFactor = clamp((viewportCenter - sceneCenter) / viewportHeight, -1, 1);
    const pointerShiftX = allowPointer ? scene.pointerX * scene.maxShift * 1.8 : 0;
    const pointerShiftY = allowPointer ? scene.pointerY * scene.maxShift * 1.4 : 0;

    scene.node.style.setProperty("--scene-pointer-x", `${((scene.pointerX + 0.5) * 100).toFixed(2)}%`);
    scene.node.style.setProperty("--scene-pointer-y", `${((scene.pointerY + 0.5) * 100).toFixed(2)}%`);
    scene.node.style.setProperty("--scene-pointer-shift-x", `${pointerShiftX.toFixed(2)}px`);
    scene.node.style.setProperty("--scene-pointer-shift-y", `${pointerShiftY.toFixed(2)}px`);
    scene.node.style.setProperty("--scene-scroll-factor", scrollFactor.toFixed(3));

    scene.layers.forEach((layer) => {
      const pointerScale = allowPointer ? 1 : 0;
      const scrollScale = prefersReducedMotion ? 0.35 : 1;
      const shiftX = scene.pointerX * scene.maxShift * layer.depth * 1.4 * pointerScale;
      const shiftY = (
        scene.pointerY * scene.maxShift * layer.depth * 1.15 * pointerScale
      ) + (
        scrollFactor * scene.maxShift * layer.depth * scrollScale
      );

      layer.node.style.setProperty("--parallax-x", `${shiftX.toFixed(2)}px`);
      layer.node.style.setProperty("--parallax-y", `${shiftY.toFixed(2)}px`);
    });
  };

  const render = () => {
    queued = false;
    activeScenes.forEach((scene) => {
      renderScene(scene);
    });
  };

  const queueRender = () => {
    if (queued) {
      return;
    }
    queued = true;
    window.requestAnimationFrame(render);
  };

  if (allowPointer) {
    scenes.forEach((scene) => {
      scene.node.addEventListener("pointermove", (event) => {
        const rect = scene.node.getBoundingClientRect();
        if (!rect.width || !rect.height) {
          return;
        }
        scene.pointerX = clamp((event.clientX - rect.left) / rect.width - 0.5, -0.5, 0.5);
        scene.pointerY = clamp((event.clientY - rect.top) / rect.height - 0.5, -0.5, 0.5);
        queueRender();
      });

      scene.node.addEventListener("pointerleave", () => {
        scene.pointerX = 0;
        scene.pointerY = 0;
        queueRender();
      });
    });
  }

  window.addEventListener("scroll", queueRender, { passive: true });
  window.addEventListener("resize", queueRender);
  queueRender();
}

function initSupportFilters() {
  const chips = qsa(".filter-chip");
  const cards = qsa(".support-card");

  if (!chips.length || !cards.length) {
    return;
  }

  const applyFilter = (value) => {
    cards.forEach((card) => {
      const category = card.getAttribute("data-category");
      const visible = value === "all" || category === value;
      card.hidden = !visible;
    });
  };

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((node) => node.setAttribute("aria-pressed", "false"));
      chip.setAttribute("aria-pressed", "true");
      applyFilter(chip.getAttribute("data-filter") || "all");
    });
  });
}

function initModals() {
  const openButtons = qsa("[data-open-modal]");

  const closeModal = () => {
    if (!state.activeModal) {
      return;
    }

    const modal = state.activeModal;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    const triggerId = modal.getAttribute("data-trigger-id");
    if (triggerId) {
      const trigger = qs(`#${triggerId}`);
      trigger?.focus();
    }
    state.activeModal = null;
  };

  const openModal = (modal, trigger) => {
    if (!modal) {
      return;
    }

    if (state.activeModal && state.activeModal !== modal) {
      state.activeModal.setAttribute("aria-hidden", "true");
    }

    if (trigger?.id) {
      modal.setAttribute("data-trigger-id", trigger.id);
    }

    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    state.activeModal = modal;

    const focusable = getFocusable(modal);
    if (focusable.length) {
      focusable[0].focus();
    }
  };

  openButtons.forEach((button, index) => {
    if (!button.id) {
      button.id = `modal-trigger-${index + 1}`;
    }

    button.addEventListener("click", () => {
      const modalId = button.getAttribute("data-open-modal");
      const modal = qs(`[data-modal-id='${modalId}']`);
      openModal(modal, button);
    });
  });

  qsa(".modal").forEach((modal) => {
    const overlay = qs("[data-close-modal]", modal);
    const closeButton = qs(".modal__close", modal);

    overlay?.addEventListener("click", closeModal);
    closeButton?.addEventListener("click", closeModal);

    modal.addEventListener("keydown", (event) => {
      if (modal.getAttribute("aria-hidden") === "true") {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
      }

      trapTabKey(event, qs(".modal__dialog", modal));
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
    }
  });
}

function normalizePhone(value) {
  const digits = value.replace(/\D/g, "");
  const normalized = digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
  const source = normalized.startsWith("7") ? normalized : `7${normalized}`;
  const clean = source.slice(0, 11);

  const parts = [
    clean.slice(1, 4),
    clean.slice(4, 7),
    clean.slice(7, 9),
    clean.slice(9, 11),
  ];

  let result = "+7";
  if (parts[0]) {
    result += ` (${parts[0]}`;
  }
  if (parts[0]?.length === 3) {
    result += ")";
  }
  if (parts[1]) {
    result += ` ${parts[1]}`;
  }
  if (parts[2]) {
    result += `-${parts[2]}`;
  }
  if (parts[3]) {
    result += `-${parts[3]}`;
  }

  return result;
}

function parseBirthdate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function calcAge(birthDate) {
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDelta = now.getMonth() - birthDate.getMonth();
  const beforeBirthday = monthDelta < 0 || (monthDelta === 0 && now.getDate() < birthDate.getDate());
  if (beforeBirthday) {
    age -= 1;
  }
  return age;
}

function clearFieldErrors(form) {
  qsa("[data-field-error]", form).forEach((node) => {
    node.textContent = "";
  });
}

function setFieldError(form, fieldName, message) {
  const node = qs(`[data-field-error='${fieldName}']`, form);
  if (node) {
    node.textContent = message;
  }
}

function showFormFeedback(form, message, type) {
  const feedback = qs("#form-feedback", form);
  if (!feedback) {
    return;
  }

  feedback.hidden = false;
  feedback.classList.remove("is-error", "is-success");
  feedback.classList.add(type === "success" ? "is-success" : "is-error");
  feedback.textContent = message;
}

function hideFormFeedback(form) {
  const feedback = qs("#form-feedback", form);
  if (!feedback) {
    return;
  }
  feedback.hidden = true;
  feedback.classList.remove("is-error", "is-success");
  feedback.textContent = "";
}

function validateStep(form, step) {
  const errors = [];

  const requiredByStep = {
    1: ["surname", "name", "birthdate", "email", "phone"],
    2: ["sphere", "wishPost", "agreeTerms"],
  };

  (requiredByStep[step] || []).forEach((field) => {
    const element = qs(`#${field}`, form);
    if (!element) {
      return;
    }

    const value = element.type === "checkbox" ? element.checked : element.value.trim();

    if (!value) {
      errors.push({ field, message: "Поле обязательно для заполнения." });
    }
  });

  const birth = qs("#birthdate", form)?.value;
  if (birth) {
    const date = parseBirthdate(birth);
    if (!date) {
      errors.push({ field: "birthdate", message: "Укажите корректную дату рождения." });
    } else {
      const age = calcAge(date);
      if (age < 18 || age > 35) {
        errors.push({ field: "birthdate", message: "Участнику должно быть от 18 до 35 лет." });
      }
    }
  }

  const email = qs("#email", form)?.value.trim();
  if (email) {
    const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    if (!validEmail) {
      errors.push({ field: "email", message: "Введите корректный email." });
    }
  }

  const phoneDigits = qs("#phone", form)?.value.replace(/\D/g, "") || "";
  if (phoneDigits.length && phoneDigits.length < 11) {
    errors.push({ field: "phone", message: "Введите номер полностью." });
  }

  return errors;
}

function updateStepUI(form, step) {
  state.currentStep = step;

  qsa(".form-step", form).forEach((node) => {
    const isActive = Number(node.getAttribute("data-step")) === step;
    node.classList.toggle("is-active", isActive);
    node.hidden = !isActive;
  });

  qsa(".form-progress__step", form).forEach((node) => {
    node.classList.toggle("is-active", Number(node.getAttribute("data-step")) === step);
  });

  const status = qs("#form-step-status", form);
  if (status) {
    status.textContent = step === 1 ? "Шаг 1 из 2" : "Шаг 2 из 2";
  }

  const backBtn = qs("#form-back", form);
  const nextBtn = qs("#form-next", form);
  const submitBtn = qs("#form-submit", form);

  if (backBtn) {
    backBtn.hidden = step === 1;
  }
  if (nextBtn) {
    nextBtn.hidden = step === 2;
  }
  if (submitBtn) {
    submitBtn.hidden = step === 1;
  }
}

function collectUTM() {
  const params = new URLSearchParams(window.location.search);
  const map = {};
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((key) => {
    const value = params.get(key);
    if (value) {
      map[key] = value;
    }
  });
  return map;
}

function createFingerprint() {
  const raw = [
    navigator.userAgent || "",
    navigator.language || "",
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    String(window.screen.width),
    String(window.screen.height),
  ].join("|");

  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }

  return `fp_${Math.abs(hash)}`;
}

async function loadSpheres(form) {
  const select = qs("#sphere", form);
  if (!select) {
    return;
  }

  const render = (items) => {
    select.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Выберите";
    select.appendChild(placeholder);

    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.value || item.id || item.code || "";
      option.textContent = item.label || item.name || String(item.value || "");
      select.appendChild(option);
    });
  };

  try {
    const spheres = await apiClient.getSpheres();
    if (spheres.length) {
      render(spheres);
      return;
    }
  } catch {
    // Silent fallback to static list.
  }

  render(staticSpheres);
}

function initApplicationForm() {
  const form = qs("#application-form");
  if (!form) {
    return;
  }

  const phoneInput = qs("#phone", form);
  const fileInput = qs("#resume", form);
  const fileName = qs("#resume-name", form);
  const nextBtn = qs("#form-next", form);
  const backBtn = qs("#form-back", form);
  const submitBtn = qs("#form-submit", form);

  updateStepUI(form, 1);
  loadSpheres(form);

  phoneInput?.addEventListener("input", () => {
    phoneInput.value = normalizePhone(phoneInput.value);
  });

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (fileName) {
      fileName.textContent = file ? `Выбран файл: ${file.name}` : "Файл не выбран";
    }
    state.resumeFileId = null;
  });

  form.addEventListener("input", () => {
    hideFormFeedback(form);
  });

  nextBtn?.addEventListener("click", () => {
    clearFieldErrors(form);
    const errors = validateStep(form, 1);
    if (errors.length) {
      errors.forEach((error) => setFieldError(form, error.field, error.message));
      return;
    }
    updateStepUI(form, 2);
    backBtn?.focus();
  });

  backBtn?.addEventListener("click", () => {
    clearFieldErrors(form);
    updateStepUI(form, 1);
    nextBtn?.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (state.isSubmitting) {
      return;
    }

    clearFieldErrors(form);
    hideFormFeedback(form);

    const step1Errors = validateStep(form, 1);
    const step2Errors = validateStep(form, 2);
    const errors = [...step1Errors, ...step2Errors];

    if (errors.length) {
      errors.forEach((error) => setFieldError(form, error.field, error.message));
      updateStepUI(form, errors.some((item) => ["surname", "name", "birthdate", "email", "phone"].includes(item.field)) ? 1 : 2);
      showFormFeedback(form, "Проверьте заполнение обязательных полей.", "error");
      return;
    }

    state.isSubmitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Отправляем...";

    try {
      const resumeFile = fileInput?.files?.[0] || null;
      if (resumeFile && !state.resumeFileId) {
        state.resumeFileId = await apiClient.uploadFile(resumeFile);
      }

      const payload = {
        personal: {
          surname: qs("#surname", form)?.value.trim(),
          name: qs("#name", form)?.value.trim(),
          middlename: qs("#middlename", form)?.value.trim() || "",
          birthdate: qs("#birthdate", form)?.value,
          email: qs("#email", form)?.value.trim(),
          phone: qs("#phone", form)?.value.trim(),
        },
        application: {
          referralCode: qs("#referral", form)?.value.trim() || "",
          region: qs("#region", form)?.value.trim() || "",
          sphere: qs("#sphere", form)?.value,
          wishPost: qs("#wishPost", form)?.value.trim(),
          wishSalary: qs("#wishSalary", form)?.value.trim() || "",
          comment: qs("#comment", form)?.value.trim() || "",
        },
        consents: {
          privacyAccepted: Boolean(qs("#agreeTerms", form)?.checked),
        },
        attachments: {
          resumeFileId: state.resumeFileId,
        },
        meta: {
          source: "web",
          utm: collectUTM(),
          timestamp: new Date().toISOString(),
          clientFingerprint: createFingerprint(),
        },
      };

      await apiClient.submitApplication(payload);
      showFormFeedback(form, "Все данные переданы ожидайте звонка", "success");
      form.reset();
      state.resumeFileId = null;
      if (fileName) {
        fileName.textContent = "Файл не выбран";
      }
      updateStepUI(form, 1);
    } catch (error) {
      if (error instanceof ApiError) {
        if (Array.isArray(error.errors) && error.errors.length) {
          error.errors.forEach((item) => {
            const rawField = item.field?.split(".").pop();
            const fieldAliases = {
              privacyAccepted: "agreeTerms",
              referralCode: "referral",
              resumeFileId: "resume",
            };
            const field = rawField ? (fieldAliases[rawField] || rawField) : "";
            if (field) {
              setFieldError(form, field, item.message || "Проверьте значение поля.");
            }
          });
        }

        const requestTail = error.requestId ? ` ID запроса: ${error.requestId}` : "";
        showFormFeedback(form, `${error.message || "Не удалось отправить заявку."}${requestTail}`, "error");
      } else {
        showFormFeedback(form, "Непредвиденная ошибка. Попробуйте еще раз позже.", "error");
      }
    } finally {
      state.isSubmitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Отправить заявку";
    }
  });
}

function initYear() {
  const yearNode = qs("#year");
  if (yearNode) {
    yearNode.textContent = String(new Date().getFullYear());
  }
}

function init() {
  initMobileMenu();
  initSmoothAnchors();
  initRevealAnimations();
  initParallaxScenes();
  initSupportFilters();
  initModals();
  initApplicationForm();
  initYear();
}

document.addEventListener("DOMContentLoaded", init);
