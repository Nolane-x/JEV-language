const root = document.documentElement;
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const target = {
  x: innerWidth / 2,
  y: innerHeight / 2,
};

const lead = { ...target };
const trail = { ...target };

let active = false;
let raf = 0;
let previousX = target.x;
let previousY = target.y;
let previousTime = performance.now();
let speed = 0;

const clamp01 = (value) => Math.max(0, Math.min(1, value));

function writeField() {
  root.style.setProperty("--mx", `${lead.x.toFixed(2)}px`);
  root.style.setProperty("--my", `${lead.y.toFixed(2)}px`);
  root.style.setProperty("--trail-x", `${trail.x.toFixed(2)}px`);
  root.style.setProperty("--trail-y", `${trail.y.toFixed(2)}px`);
  root.style.setProperty("--pointer-speed", speed.toFixed(3));
  root.style.setProperty("--pointer-active", active ? "1" : "0");
  root.dataset.pointerActive = active ? "true" : "false";
}

function tick() {
  raf = 0;
  if (!finePointer.matches || reducedMotion.matches) {
    active = false;
    writeField();
    return;
  }

  lead.x += (target.x - lead.x) * 0.38;
  lead.y += (target.y - lead.y) * 0.38;
  trail.x += (lead.x - trail.x) * 0.11;
  trail.y += (lead.y - trail.y) * 0.11;

  writeField();

  const unsettled =
    Math.abs(target.x - lead.x) > 0.15 ||
    Math.abs(target.y - lead.y) > 0.15 ||
    Math.abs(lead.x - trail.x) > 0.15 ||
    Math.abs(lead.y - trail.y) > 0.15;

  if (unsettled || active) {
    raf = requestAnimationFrame(tick);
  }
}

function ensureTick() {
  if (!raf) raf = requestAnimationFrame(tick);
}

function localField(event) {
  const surface = event.target.closest?.(
    ".reactive, .message, .composer, .key-panel",
  );
  if (!surface) return;

  const rect = surface.getBoundingClientRect();
  surface.style.setProperty("--rx", `${event.clientX - rect.left}px`);
  surface.style.setProperty("--ry", `${event.clientY - rect.top}px`);
  surface.dataset.fieldNear = "true";
}

function clearLocalField(event) {
  const surface = event.target.closest?.(
    ".reactive, .message, .composer, .key-panel",
  );
  if (!surface) return;
  surface.dataset.fieldNear = "false";
}

function onPointerMove(event) {
  if (event.pointerType === "touch" || !finePointer.matches) return;

  const now = performance.now();
  const distance = Math.hypot(
    event.clientX - previousX,
    event.clientY - previousY,
  );
  const elapsed = Math.max(8, now - previousTime);
  speed = clamp01((distance / elapsed) / 1.8);

  previousX = event.clientX;
  previousY = event.clientY;
  previousTime = now;

  target.x = event.clientX;
  target.y = event.clientY;
  active = true;

  localField(event);
  ensureTick();
}

function onPointerEnter(event) {
  if (event.pointerType === "touch" || !finePointer.matches) return;
  active = true;
  ensureTick();
}

function onPointerLeave() {
  active = false;
  speed = 0;
  root.style.setProperty("--pointer-active", "0");
  root.dataset.pointerActive = "false";
  document
    .querySelectorAll('[data-field-near="true"]')
    .forEach((node) => {
      node.dataset.fieldNear = "false";
    });
  ensureTick();
}

document.addEventListener("pointermove", onPointerMove, { passive: true });
document.addEventListener("pointerover", localField, { passive: true });
document.addEventListener("pointerout", clearLocalField, { passive: true });
window.addEventListener("pointerenter", onPointerEnter, { passive: true });
window.addEventListener("pointerleave", onPointerLeave, { passive: true });

const refreshCapability = () => {
  if (!finePointer.matches || reducedMotion.matches) {
    active = false;
    root.style.setProperty("--pointer-active", "0");
    root.dataset.pointerActive = "false";
  }
  ensureTick();
};

finePointer.addEventListener?.("change", refreshCapability);
reducedMotion.addEventListener?.("change", refreshCapability);

writeField();
