export const escapeRegExp = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const formatPercent = (value) => {
  if (!Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
};

export const yesNoLike = (text) => {
  const value = text.trim();
  if (/\b(c[oó]\b.*\bkh[oô]ng\b|n[eê]n\b.*\bkh[oô]ng\b|ph[aả]i\s+kh[oô]ng|[dđ][uú]ng\s+kh[oô]ng|li[eệ]u\b)/iu.test(value)) {
    return true;
  }
  return /^(is|are|am|was|were|do|does|did|can|could|should|would|will|has|have|had|may|might|must)\b/iu.test(
    value,
  );
};

const cleanOption = (value) =>
  value
    .replace(/^[\s,:;\-–—]+|[\s,?.!;:]+$/gu, "")
    .replace(/^(choose|pick|between|nên chọn|chọn)\s+/iu, "")
    .trim();

export const extractOptions = (text) => {
  const value = text.trim().replace(/[?？]\s*$/u, "");
  const separators = [" or ", " hay ", " hoặc ", " vs ", " versus "];
  for (const separator of separators) {
    const re = new RegExp(escapeRegExp(separator), "iu");
    if (!re.test(value)) continue;
    const chunks = value.split(re).map(cleanOption).filter(Boolean);
    if (chunks.length !== 2) continue;
    let [left, right] = chunks;
    left = left.split(/[,;:]/u).at(-1)?.trim() || left;
    left = left.replace(
      /^(should i choose|should we choose|would you choose|which is better|what is better|should i|should we|nên chọn|tôi nên chọn|chúng ta nên chọn|nên|tôi nên|chúng ta nên)\s+/iu,
      "",
    );
    right = right.replace(/^(should i choose|should we choose|should i|should we|nên chọn|tôi nên chọn)\s+/iu, "");
    left = cleanOption(left);
    right = cleanOption(right);
    if (
      left.length >= 2 &&
      right.length >= 2 &&
      left.length <= 110 &&
      right.length <= 110
    ) {
      return [left, right];
    }
  }
  return null;
};

export const isGreeting = (text) =>
  /^(hi|hello|hey|xin ch[aà]o|ch[aà]o|alo|yo)[!.\s]*$/iu.test(text.trim());

export const choiceQuestion = (instructions, labels) => ({
  type: "choice",
  instructions,
  criteria: Object.fromEntries(labels.map((label) => [label, null])),
});

export const noulQuestion = (instructions) => ({
  type: "noul",
  instructions,
});

export const scoreQuestion = (instructions, criteria) => ({
  type: "score",
  instructions,
  criteria,
});

export const answerAt = (body, key) => body?.answers?.[key] ?? null;

export const renderYesNo = (answer, support) => {
  const probability = Number(answer?.noul);
  if (!Number.isFinite(probability)) {
    return "Jev returned an unexpected yes/no shape, so I won’t pretend the result is valid.";
  }
  const confidence = Number(answer?.confidence);
  const yes = probability >= 0.5;
  const uncertain = probability > 0.35 && probability < 0.65;
  const p = formatPercent(yes ? probability : 1 - probability);
  const prefix = uncertain
    ? "The evidence is close."
    : `Jev leans ${yes ? "yes" : "no"}.`;
  const why = support?.choice
    ? ` Its response posture is “${support.choice.replaceAll("_", " ")}”.`
    : "";
  return `${prefix} ${p ? `Directional probability: ${p}.` : ""}${why}${
    Number.isFinite(confidence)
      ? ` Confidence signal: ${formatPercent(confidence)}.`
      : ""
  }`.trim();
};

export const renderChoice = (answer, originalOptions) => {
  const pickedKey = answer?.choice;
  const index = pickedKey === "option_a" ? 0 : pickedKey === "option_b" ? 1 : -1;
  if (index < 0) {
    return "Jev returned an unexpected choice shape, so I won’t invent a winner.";
  }
  const selected = originalOptions[index];
  const confidence = formatPercent(Number(answer?.confidence));
  const probabilities = answer?.probabilities;
  const a = formatPercent(Number(probabilities?.option_a));
  const b = formatPercent(Number(probabilities?.option_b));
  const breakdown =
    a && b
      ? ` Option weights: ${originalOptions[0]} ${a}, ${originalOptions[1]} ${b}.`
      : "";
  return `Jev chooses ${selected}${
    confidence ? ` with ${confidence} confidence` : ""
  }.${breakdown}`;
};

export const renderMeta = (body) => {
  const mode = answerAt(body, "mode");
  const answerability = answerAt(body, "answerability");
  const clarify = answerAt(body, "needs_clarification");
  const modeLabel = mode?.choice?.replaceAll("_", " ") || "open-ended";
  const score = Number(answerability?.score);
  const clarifyProb = Number(clarify?.noul);
  const canDecide = Number.isFinite(score) && score >= 1;

  if (canDecide && Number.isFinite(clarifyProb) && clarifyProb < 0.5) {
    return `Jev reads this as ${modeLabel}, but this browser-safe JEV Language surface does not yet have a verified free-form realizer for that request. I’m keeping the boundary explicit instead of fabricating prose.`;
  }
  return `Jev reads this as ${modeLabel}. The current browser-safe surface needs a yes/no proposition or explicit alternatives before it can return a decision without inventing missing output space.`;
};
