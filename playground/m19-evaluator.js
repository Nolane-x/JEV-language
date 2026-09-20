const MAX_FILE_BYTES = 2 * 1024 * 1024;
const WORKSHEET_SCHEMA = "jl-m19-rating-worksheet-1";
const TEMPLATE_VALUES = new Set(["template", "not-template", "unsure"]);
const SCORE_FIELDS = ["naturalness", "semanticAccuracy", "multiTurnCoherence"];

const state = {
  worksheet: null,
  order: [],
  position: 0,
  started: false,
};

const els = {
  worksheetFile: document.querySelector("#worksheetFile"),
  evaluatorId: document.querySelector("#evaluatorId"),
  setupStatus: document.querySelector("#setupStatus"),
  startStudyButton: document.querySelector("#startStudyButton"),
  clearStudyButton: document.querySelector("#clearStudyButton"),
  setupPanel: document.querySelector("#setupPanel"),
  ratingStage: document.querySelector("#ratingStage"),
  progressText: document.querySelector("#progressText"),
  completionText: document.querySelector("#completionText"),
  progressBar: document.querySelector("#progressBar"),
  stimulusContext: document.querySelector("#stimulusContext"),
  stimulusOutput: document.querySelector("#stimulusOutput"),
  previousButton: document.querySelector("#previousButton"),
  nextButton: document.querySelector("#nextButton"),
  exitButton: document.querySelector("#exitButton"),
  exportPanel: document.querySelector("#exportPanel"),
  exportButton: document.querySelector("#exportButton"),
  scoreButtons: [...document.querySelectorAll("[data-score]")],
  judgmentButtons: [...document.querySelectorAll("[data-judgment]")],
};

function setStatus(message = "", kind = "") {
  els.setupStatus.textContent = message;
  els.setupStatus.dataset.state = kind;
}

function isScore(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function validateWorksheet(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    input.schemaVersion !== WORKSHEET_SCHEMA ||
    typeof input.studyId !== "string" ||
    input.studyId.trim() === "" ||
    input.blinded !== true ||
    typeof input.evaluatorId !== "string" ||
    !Array.isArray(input.rows) ||
    input.rows.length === 0
  ) {
    throw new Error("This is not a valid blinded M19 rating worksheet.");
  }

  const pairs = new Set();
  const rows = input.rows.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      typeof row.itemId !== "string" ||
      row.itemId.trim() === "" ||
      typeof row.armCode !== "string" ||
      row.armCode.trim() === "" ||
      typeof row.context !== "string" ||
      row.context.trim() === "" ||
      typeof row.output !== "string" ||
      row.output.trim() === ""
    ) {
      throw new Error("Every worksheet row must contain blinded IDs, context, and output.");
    }

    if ("latencyMs" in row || "costUnits" in row || "semanticEvidenceRefs" in row) {
      throw new Error("Evaluator worksheets must not expose latency, cost, or semantic-evidence metadata.");
    }

    const pair = `${row.itemId}\u0000${row.armCode}`;
    if (pairs.has(pair)) {
      throw new Error("The worksheet contains a duplicate blinded stimulus.");
    }
    pairs.add(pair);

    for (const field of SCORE_FIELDS) {
      if (row[field] !== null && !isScore(row[field])) {
        throw new Error(`Invalid ${field} score in worksheet.`);
      }
    }
    if (
      row.templateJudgment !== null &&
      !TEMPLATE_VALUES.has(row.templateJudgment)
    ) {
      throw new Error("Invalid template judgment in worksheet.");
    }

    return {
      itemId: row.itemId,
      armCode: row.armCode,
      context: row.context,
      output: row.output,
      naturalness: row.naturalness,
      semanticAccuracy: row.semanticAccuracy,
      multiTurnCoherence: row.multiTurnCoherence,
      templateJudgment: row.templateJudgment,
    };
  });

  return {
    schemaVersion: WORKSHEET_SCHEMA,
    studyId: input.studyId,
    blinded: true,
    evaluatorId: "",
    rows,
  };
}

function hashSeed(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledIndices(length, seedText) {
  const order = Array.from({ length }, (_, index) => index);
  const random = seededRandom(hashSeed(seedText));
  for (let index = order.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [order[index], order[target]] = [order[target], order[index]];
  }
  return order;
}

function currentRow() {
  if (!state.worksheet || state.order.length === 0) return null;
  return state.worksheet.rows[state.order[state.position]] ?? null;
}

function rowComplete(row) {
  return (
    row &&
    SCORE_FIELDS.every((field) => isScore(row[field])) &&
    TEMPLATE_VALUES.has(row.templateJudgment)
  );
}

function completedCount() {
  return state.worksheet
    ? state.worksheet.rows.filter((row) => rowComplete(row)).length
    : 0;
}

function updateSetupButtons() {
  const evaluatorId = els.evaluatorId.value.trim();
  els.startStudyButton.disabled = !(state.worksheet && evaluatorId);
  els.clearStudyButton.disabled = !state.worksheet && !els.worksheetFile.value;
}

function updateRatingControls() {
  const row = currentRow();
  if (!row) return;

  for (const button of els.scoreButtons) {
    const metric = button.closest("[data-metric]")?.dataset.metric;
    const score = Number(button.dataset.score);
    const selected = metric && row[metric] === score;
    button.dataset.selected = selected ? "true" : "false";
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  }

  for (const button of els.judgmentButtons) {
    const selected = row.templateJudgment === button.dataset.judgment;
    button.dataset.selected = selected ? "true" : "false";
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  }
}

function renderCurrent() {
  const row = currentRow();
  if (!row || !state.worksheet) return;

  els.stimulusContext.textContent = row.context;
  els.stimulusOutput.textContent = row.output;

  const total = state.order.length;
  const complete = completedCount();
  els.progressText.textContent = `${state.position + 1} / ${total}`;
  els.completionText.textContent = `${complete} rated`;
  els.progressBar.style.width = `${Math.round((complete / total) * 100)}%`;

  els.previousButton.disabled = state.position === 0;
  els.nextButton.textContent =
    state.position === total - 1 ? "Review completion" : "Next stimulus";
  els.exportPanel.hidden = complete !== total;

  updateRatingControls();
}

function clearStudy() {
  state.worksheet = null;
  state.order = [];
  state.position = 0;
  state.started = false;
  els.worksheetFile.value = "";
  els.evaluatorId.value = "";
  els.setupPanel.hidden = false;
  els.ratingStage.hidden = true;
  els.exportPanel.hidden = true;
  setStatus("");
  updateSetupButtons();
}

async function loadWorksheet(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Worksheet is larger than the 2 MB evaluator limit.");
  }
  const raw = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Worksheet is not valid JSON.");
  }
  state.worksheet = validateWorksheet(parsed);
  state.order = [];
  state.position = 0;
  state.started = false;
  setStatus(
    `Loaded blinded study “${state.worksheet.studyId}” with ${state.worksheet.rows.length} stimuli.`,
    "success",
  );
  updateSetupButtons();
}

function startStudy() {
  if (!state.worksheet) return;
  const evaluatorId = els.evaluatorId.value.trim();
  if (!evaluatorId) {
    setStatus("Enter a pseudonymous evaluator ID before starting.", "error");
    return;
  }

  state.worksheet.evaluatorId = evaluatorId;
  state.order = shuffledIndices(
    state.worksheet.rows.length,
    `${state.worksheet.studyId}\u0000${evaluatorId}`,
  );
  state.position = 0;
  state.started = true;
  els.evaluatorId.disabled = true;
  els.setupPanel.hidden = true;
  els.ratingStage.hidden = false;
  renderCurrent();
}

function backToSetup() {
  if (!state.worksheet) return;
  state.started = false;
  els.evaluatorId.disabled = false;
  els.setupPanel.hidden = false;
  els.ratingStage.hidden = true;
  setStatus(
    `Review paused in memory: ${completedCount()} of ${state.worksheet.rows.length} stimuli rated.`,
    "success",
  );
  updateSetupButtons();
}

function setScore(button) {
  const row = currentRow();
  const metric = button.closest("[data-metric]")?.dataset.metric;
  const score = Number(button.dataset.score);
  if (!row || !SCORE_FIELDS.includes(metric) || !isScore(score)) return;
  row[metric] = score;
  renderCurrent();
}

function setJudgment(button) {
  const row = currentRow();
  const value = button.dataset.judgment;
  if (!row || !TEMPLATE_VALUES.has(value)) return;
  row.templateJudgment = value;
  renderCurrent();
}

function move(delta) {
  if (!state.worksheet) return;
  const next = Math.max(0, Math.min(state.position + delta, state.order.length - 1));
  state.position = next;
  renderCurrent();
}

function exportWorksheet() {
  if (!state.worksheet || completedCount() !== state.worksheet.rows.length) {
    return;
  }

  const payload = JSON.stringify(state.worksheet, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const safeEvaluator = state.worksheet.evaluatorId
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "evaluator";
  const link = document.createElement("a");
  link.href = url;
  link.download = `m19-${state.worksheet.studyId}-${safeEvaluator}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

els.worksheetFile.addEventListener("change", async () => {
  const file = els.worksheetFile.files?.[0];
  if (!file) return;
  try {
    await loadWorksheet(file);
  } catch (error) {
    state.worksheet = null;
    setStatus(error instanceof Error ? error.message : String(error), "error");
    updateSetupButtons();
  }
});

els.evaluatorId.addEventListener("input", updateSetupButtons);
els.startStudyButton.addEventListener("click", startStudy);
els.clearStudyButton.addEventListener("click", clearStudy);
els.exitButton.addEventListener("click", backToSetup);
els.previousButton.addEventListener("click", () => move(-1));
els.nextButton.addEventListener("click", () => move(1));
els.exportButton.addEventListener("click", exportWorksheet);
els.scoreButtons.forEach((button) =>
  button.addEventListener("click", () => setScore(button)),
);
els.judgmentButtons.forEach((button) =>
  button.addEventListener("click", () => setJudgment(button)),
);

updateSetupButtons();
