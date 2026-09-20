import {
  answerAt,
  choiceQuestion,
  extractOptions,
  isGreeting,
  noulQuestion,
  renderChoice,
  renderMeta,
  renderYesNo,
  scoreQuestion,
  yesNoLike,
} from "./runtime.js";

const API_URL = "https://api.typesafe.ai/v1/systemone";
const MAX_CONTEXT_TURNS = 10;

const state = {
  apiKey: "",
  model: "jev-latest",
  connected: false,
  busy: false,
  turns: [],
};

const els = {
  runtimeState: document.querySelector("#runtimeState"),
  openKeyButton: document.querySelector("#openKeyButton"),
  keyButtonLabel: document.querySelector("#keyButtonLabel"),
  keyDialog: document.querySelector("#keyDialog"),
  closeKeyButton: document.querySelector("#closeKeyButton"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  modelSelect: document.querySelector("#modelSelect"),
  browserConsent: document.querySelector("#browserConsent"),
  toggleKeyVisibility: document.querySelector("#toggleKeyVisibility"),
  connectButton: document.querySelector("#connectButton"),
  disconnectButton: document.querySelector("#disconnectButton"),
  keyPanelStatus: document.querySelector("#keyPanelStatus"),
  composerForm: document.querySelector("#composerForm"),
  composerInput: document.querySelector("#composerInput"),
  sendButton: document.querySelector("#sendButton"),
  thread: document.querySelector("#thread"),
  emptyState: document.querySelector("#emptyState"),
  chatRegion: document.querySelector("#chatRegion"),
  messageTemplate: document.querySelector("#messageTemplate"),
  promptChips: [...document.querySelectorAll("[data-prompt]")],
};

function setRuntime(kind, label) {
  els.runtimeState.dataset.state = kind;
  els.runtimeState.querySelector("span").textContent = label;
}

function setKeyStatus(message = "", kind = "") {
  els.keyPanelStatus.textContent = message;
  els.keyPanelStatus.dataset.state = kind;
}

function updateConnectionUi() {
  els.keyButtonLabel.textContent = state.connected ? "Connected" : "Connect key";
  els.disconnectButton.hidden = !state.connected;
  setRuntime(state.connected ? "connected" : "idle", state.connected ? state.model : "Local shell");
}

function updateSendState() {
  const hasText = els.composerInput.value.trim().length > 0;
  els.sendButton.disabled = state.busy || !hasText;
}

function autoresize() {
  els.composerInput.style.height = "auto";
  els.composerInput.style.height = `${Math.min(els.composerInput.scrollHeight, 180)}px`;
}

function serializeDetails(details) {
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

function addMessage(role, text, { details = null, loading = false } = {}) {
  const node = els.messageTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.role = role;
  if (loading) node.dataset.loading = "true";
  const meta = node.querySelector(".message__meta");
  const body = node.querySelector(".message__body");
  const detailEl = node.querySelector(".message__details");
  meta.textContent = role === "assistant" ? "JEV Language" : "You";

  if (loading) {
    body.innerHTML = '<span class="thinking-line" aria-label="Thinking"><span></span><span></span><span></span></span>';
  } else {
    body.textContent = text;
  }

  if (details) {
    detailEl.hidden = false;
    detailEl.querySelector("pre").textContent = serializeDetails(details);
  }

  els.thread.append(node);
  els.emptyState.hidden = true;
  requestAnimationFrame(() => {
    els.chatRegion.scrollTo({ top: els.chatRegion.scrollHeight, behavior: "smooth" });
  });
  return node;
}

function replaceLoadingMessage(node, text, details = null) {
  node.dataset.loading = "false";
  node.querySelector(".message__body").textContent = text;
  const detailEl = node.querySelector(".message__details");
  if (details) {
    detailEl.hidden = false;
    detailEl.querySelector("pre").textContent = serializeDetails(details);
  }
}

function normalizedContext() {
  return state.turns.slice(-MAX_CONTEXT_TURNS).map((turn) => ({
    role: turn.role,
    text: turn.text,
  }));
}

function buildState(latest) {
  return {
    latest_user_message: latest,
    conversation: normalizedContext(),
    note: "The UI is a JEV Language experimental playground. Preserve uncertainty. Do not infer evidence that is not in the state.",
  };
}

async function callJev(questions, latest) {
  if (!state.connected || !state.apiKey) {
    throw new Error("Connect a TypeSafe API key before sending a decision-shaped prompt.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const started = performance.now();
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      mode: "cors",
      headers: {
        Authorization: `Bearer ${state.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: state.model,
        state: buildState(latest),
        questions,
      }),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    let body;
    try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { body = { raw: bodyText }; }

    if (!response.ok) {
      const message = body?.error?.message || body?.message || `TypeSafe returned HTTP ${response.status}.`;
      const error = new Error(message);
      error.status = response.status;
      error.body = body;
      throw error;
    }

    return {
      body,
      latencyMs: Math.round(performance.now() - started),
      requestId: response.headers.get("x-typesafe-request-id"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolvePrompt(text) {
  if (isGreeting(text)) {
    return {
      text: "Hello. Give me a yes/no question or an explicit choice such as “retry or fail-fast?” and I’ll route it through Jev.",
      details: { local: true, reason: "deterministic greeting; no API quota consumed" },
    };
  }

  const options = extractOptions(text);
  if (options) {
    const result = await callJev({
      decision: choiceQuestion(
        "Choose the option that is better supported by the latest user request and conversation context. Preserve uncertainty through confidence rather than inventing facts.",
        ["option_a", "option_b"],
      ),
    }, text);
    return {
      text: renderChoice(answerAt(result.body, "decision"), options),
      details: { type: "choice", options, ...result },
    };
  }

  if (yesNoLike(text)) {
    const result = await callJev({
      answer: noulQuestion(
        "Answer the latest user's yes/no proposition. Use only the supplied conversation state and ordinary decision judgment; calibrated probability must express uncertainty.",
      ),
      posture: choiceQuestion(
        "What posture best fits the answer?",
        ["direct", "cautious", "needs_more_context"],
      ),
    }, text);
    return {
      text: renderYesNo(answerAt(result.body, "answer"), answerAt(result.body, "posture")),
      details: { type: "yes-no", ...result },
    };
  }

  const result = await callJev({
    mode: choiceQuestion("Classify the latest user message by response shape.", [
      "factual_open",
      "advice",
      "classification",
      "comparison",
      "instruction",
      "casual",
      "other",
    ]),
    answerability: scoreQuestion(
      "How safely can the current typed-decision surface answer this without a free-form string generator?",
      [
        "Not answerable without inventing an output space",
        "Partially answerable as a decision",
        "Directly answerable as a bounded decision",
      ],
    ),
    needs_clarification: noulQuestion(
      "Would an explicit yes/no proposition or explicit candidate choices materially improve answerability?",
    ),
  }, text);
  return {
    text: renderMeta(result.body),
    details: { type: "coverage-check", ...result },
  };
}

async function submitMessage(text) {
  const clean = text.trim();
  if (!clean || state.busy) return;

  if (!state.connected && !isGreeting(clean)) {
    els.apiKeyInput.value = "";
    els.keyDialog.showModal();
    setKeyStatus("Connect a key first. It will stay in this tab’s memory only.");
    return;
  }

  state.busy = true;
  updateSendState();
  setRuntime("busy", "Jev decision");
  addMessage("user", clean);
  state.turns.push({ role: "user", text: clean });
  els.composerInput.value = "";
  autoresize();

  const loading = addMessage("assistant", "", { loading: true });
  try {
    const result = await resolvePrompt(clean);
    replaceLoadingMessage(loading, result.text, result.details);
    state.turns.push({ role: "assistant", text: result.text });
    setRuntime(state.connected ? "connected" : "idle", state.connected ? state.model : "Local shell");
  } catch (error) {
    const status = error?.status;
    let message = "The request failed without a trustworthy result.";
    if (error?.name === "AbortError") message = "The TypeSafe request timed out. Nothing was inferred from the failed call.";
    else if (status === 401) message = "That API key was rejected by TypeSafe. Reconnect with a valid key.";
    else if (status === 403) message = "TypeSafe refused this request for the connected account.";
    else if (status === 429) message = "TypeSafe rate-limited this request. Try again after the account limit resets.";
    else if (error?.message) message = error.message;

    replaceLoadingMessage(loading, message, {
      error: true,
      status: status ?? null,
      message: error?.message ?? String(error),
    });
    setRuntime("error", "Request failed");
  } finally {
    state.busy = false;
    updateSendState();
    els.composerInput.focus();
  }
}

async function connectKey() {
  const key = els.apiKeyInput.value.trim();
  if (!key) {
    setKeyStatus("Paste an API key first.", "error");
    return;
  }
  if (!els.browserConsent.checked) {
    setKeyStatus("Acknowledge the browser-side key exposure before connecting.", "error");
    return;
  }

  els.connectButton.disabled = true;
  els.connectButton.textContent = "Checking…";
  setKeyStatus("Checking the key directly with TypeSafe…");

  try {
    const response = await fetch("https://api.typesafe.ai/v1/models", {
      method: "GET",
      mode: "cors",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(
        new Error(payload?.error?.message || payload?.message || `TypeSafe returned HTTP ${response.status}.`),
        { status: response.status },
      );
    }
    const models = Array.isArray(payload?.models) ? payload.models : [];
    const names = models.map((model) => model?.name).filter((name) => typeof name === "string" && name.trim());
    if (names.length > 0) {
      const previous = els.modelSelect.value;
      els.modelSelect.replaceChildren(...names.map((name) => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        return option;
      }));
      els.modelSelect.value = names.includes(previous) ? previous : (names.includes("jev-latest") ? "jev-latest" : names[0]);
    }

    state.apiKey = key;
    state.model = els.modelSelect.value;
    state.connected = true;
    els.apiKeyInput.value = "";
    setKeyStatus("Connected in memory. No browser storage was written.", "success");
    updateConnectionUi();
    window.setTimeout(() => els.keyDialog.close(), 320);
    els.composerInput.focus();
  } catch (error) {
    state.apiKey = "";
    state.connected = false;
    const suffix = error?.status === 401 ? " Check that the key is valid." : " If the browser reports CORS, TypeSafe may not permit direct browser access for this account/origin.";
    setKeyStatus(`${error?.message || "Connection test failed."}${suffix}`, "error");
    updateConnectionUi();
  } finally {
    els.connectButton.disabled = false;
    els.connectButton.textContent = "Connect";
  }
}

function disconnectKey() {
  state.apiKey = "";
  state.connected = false;
  setKeyStatus("Disconnected. The in-memory key was cleared.", "success");
  updateConnectionUi();
}

els.openKeyButton.addEventListener("click", () => {
  els.modelSelect.value = state.model;
  els.browserConsent.checked = false;
  setKeyStatus(state.connected ? "A key is connected in memory for this tab." : "");
  els.keyDialog.showModal();
  window.setTimeout(() => els.apiKeyInput.focus(), 30);
});
els.closeKeyButton.addEventListener("click", () => setKeyStatus(""));
els.connectButton.addEventListener("click", connectKey);
els.disconnectButton.addEventListener("click", disconnectKey);
els.toggleKeyVisibility.addEventListener("click", () => {
  const show = els.apiKeyInput.type === "password";
  els.apiKeyInput.type = show ? "text" : "password";
  els.toggleKeyVisibility.setAttribute("aria-label", show ? "Hide API key" : "Show API key");
});

els.composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitMessage(els.composerInput.value);
});
els.composerInput.addEventListener("input", () => {
  autoresize();
  updateSendState();
});
els.composerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submitMessage(els.composerInput.value);
  }
});
els.promptChips.forEach((button) => {
  button.addEventListener("click", () => {
    els.composerInput.value = button.dataset.prompt || "";
    autoresize();
    updateSendState();
    els.composerInput.focus();
  });
});

els.keyDialog.addEventListener("click", (event) => {
  if (event.target === els.keyDialog) els.keyDialog.close();
});

if (new URLSearchParams(location.search).has("preview")) {
  els.emptyState.hidden = true;
  addMessage("user", "For a latency-sensitive path, should I choose retry or fail-fast?");
  addMessage("assistant", "Jev chooses fail-fast with 78% confidence. Option weights: retry 22%, fail-fast 78%.", {
    details: {
      preview: true,
      note: "Visual preview only — no TypeSafe request was made.",
      answers: { decision: { choice: "option_b", confidence: 0.78, probabilities: { option_a: 0.22, option_b: 0.78 } } },
    },
  });
}

autoresize();
updateSendState();
updateConnectionUi();
