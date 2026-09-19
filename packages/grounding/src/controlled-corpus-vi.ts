import {
  err,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import {
  buildControlledFrame,
  type ControlledCorpusParse,
  type ControlledFrame,
} from "./controlled-corpus.ts";

const integer = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const viRe = (pattern: string): RegExp =>
  new RegExp(pattern.normalize("NFC"), "iu");

const eventFrame = (
  amount: number,
  input: {
    polarity?: "positive" | "negative";
    aspect?: "completed" | "ongoing" | "planned";
    date?: string;
  } = {},
): ControlledFrame => ({
  kind: "event",
  amount,
  comparator: "exact",
  polarity: input.polarity ?? "positive",
  ...(input.aspect === undefined ? {} : { aspect: input.aspect }),
  ...(input.date === undefined ? {} : { date: input.date }),
  phenomena: [
    "simple-event",
    ...(input.polarity === "negative" ? (["negation"] as const) : []),
    "exact-quantity",
    ...(input.date === undefined ? [] : (["time"] as const)),
  ],
});

const parseVietnameseFrame = (text: string): ControlledFrame | undefined => {
  let match = viRe(
    String.raw`^Dịch vụ\s+(đã|đang|sẽ)\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[2]);
    if (amount === undefined) return undefined;
    const marker = match[1]?.normalize("NFC").toLocaleLowerCase("vi");
    const aspect =
      marker === "đã"
        ? "completed"
        : marker === "đang"
          ? "ongoing"
          : "planned";
    return eventFrame(amount, { aspect });
  }

  match = viRe(
    String.raw`^Dịch vụ\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)(?:\s+vào\s+(\d{4}-\d{2}-\d{2}))?\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return eventFrame(amount, {
      ...(match[2] === undefined ? {} : { date: match[2] }),
    });
  }

  match = viRe(
    String.raw`^Dịch vụ\s+không\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    return amount === undefined
      ? undefined
      : eventFrame(amount, { polarity: "negative" });
  }

  match = viRe(
    String.raw`^Dịch vụ\s+phải\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "constraint",
      amount,
      comparator: "exact",
      constraintKind: "requirement",
      predicate: "concept:core.requirement",
      phenomena: ["requirement", "exact-quantity"],
    };
  }

  match = viRe(
    String.raw`^Dịch vụ\s+(?:được\s+phép|có\s+thể)\s+xóa\s+(?:tối\s+đa|không\s+quá)\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "constraint",
      amount,
      comparator: "at-most",
      constraintKind: "permission",
      predicate: "concept:core.permission",
      phenomena: ["permission", "comparison"],
    };
  }

  if (
    viRe(
      String.raw`^Dịch vụ\s+không\s+được(?:\s+phép)?\s+xóa\s+(?:bất\s+kỳ\s+)?(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\s+nào\.?$`,
    ).test(text)
  ) {
    return {
      kind: "constraint",
      amount: 0,
      comparator: "at-most",
      constraintKind: "prohibition",
      predicate: "concept:core.prohibition",
      phenomena: ["prohibition", "negation"],
    };
  }

  match = viRe(
    String.raw`^Dịch vụ\s+không\s+được(?:\s+phép)?\s+xóa\s+quá\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "constraint",
      amount,
      comparator: "at-most",
      constraintKind: "requirement",
      predicate: "concept:core.maximum-cardinality",
      phenomena: ["requirement", "negation", "comparison"],
    };
  }

  match = viRe(
    String.raw`^Nếu\s+việc\s+xóa\s+bị\s+cấm,\s*dịch vụ\s+không\s+được(?:\s+phép)?\s+xóa\s+quá\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "condition",
      amount,
      phenomena: ["condition", "requirement", "negation", "comparison"],
    };
  }

  match = viRe(
    String.raw`^Dịch vụ\s+không\s+được(?:\s+phép)?\s+xóa\s+quá\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\s+vì\s+việc\s+xóa\s+bị\s+cấm\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "cause",
      amount,
      phenomena: ["cause", "requirement", "negation", "comparison"],
    };
  }

  match = viRe(
    String.raw`^Theo\s+dịch vụ,\s*dịch vụ\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "attributed-proposition",
      amount,
      phenomena: ["simple-event", "exact-quantity", "attribution"],
    };
  }

  match = viRe(
    String.raw`^Dịch vụ\s+có\s+được(?:\s+phép)?\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\s+không\?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "question",
      amount,
      phenomena: ["question", "permission", "exact-quantity"],
    };
  }

  if (
    viRe(
      String.raw`^Ở\s+đây,\s*["“]nó["”]\s+chỉ\s+dịch\s+vụ\.?import {
  err,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import {
  buildControlledFrame,
  type ControlledCorpusParse,
  type ControlledFrame,
} from "./controlled-corpus.ts";

const integer = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const viRe = (pattern: string): RegExp =>
  new RegExp(pattern.normalize("NFC"), "iu");

const eventFrame = (
  amount: number,
  input: {
    polarity?: "positive" | "negative";
    aspect?: "completed" | "ongoing" | "planned";
    date?: string;
  } = {},
): ControlledFrame => ({
  kind: "event",
  amount,
  comparator: "exact",
  polarity: input.polarity ?? "positive",
  ...(input.aspect === undefined ? {} : { aspect: input.aspect }),
  ...(input.date === undefined ? {} : { date: input.date }),
  phenomena: [
    "simple-event",
    ...(input.polarity === "negative" ? (["negation"] as const) : []),
    "exact-quantity",
    ...(input.date === undefined ? [] : (["time"] as const)),
  ],
});

const parseVietnameseFrame = (text: string): ControlledFrame | undefined => {
  let match = viRe(
    String.raw`^Dịch vụ\s+(đã|đang|sẽ)\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[2]);
    if (amount === undefined) return undefined;
    const marker = match[1]?.normalize("NFC").toLocaleLowerCase("vi");
    const aspect =
      marker === "đã"
        ? "completed"
        : marker === "đang"
          ? "ongoing"
          : "planned";
    return eventFrame(amount, { aspect });
  }

  match = viRe(
    String.raw`^Dịch vụ\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)(?:\s+vào\s+(\d{4}-\d{2}-\d{2}))?\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return eventFrame(amount, {
      ...(match[2] === undefined ? {} : { date: match[2] }),
    });
  }

  match = viRe(
    String.raw`^Dịch vụ\s+không\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    return amount === undefined
      ? undefined
      : eventFrame(amount, { polarity: "negative" });
  }

  match = viRe(
    String.raw`^Dịch vụ\s+phải\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "constraint",
      amount,
      comparator: "exact",
      constraintKind: "requirement",
      predicate: "concept:core.requirement",
      phenomena: ["requirement", "exact-quantity"],
    };
  }

  match = viRe(
    String.raw`^Dịch vụ\s+(?:được\s+phép|có\s+thể)\s+xóa\s+(?:tối\s+đa|không\s+quá)\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "constraint",
      amount,
      comparator: "at-most",
      constraintKind: "permission",
      predicate: "concept:core.permission",
      phenomena: ["permission", "comparison"],
    };
  }

  if (
    viRe(
      String.raw`^Dịch vụ\s+không\s+được(?:\s+phép)?\s+xóa\s+(?:bất\s+kỳ\s+)?(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\s+nào\.?$`,
    ).test(text)
  ) {
    return {
      kind: "constraint",
      amount: 0,
      comparator: "at-most",
      constraintKind: "prohibition",
      predicate: "concept:core.prohibition",
      phenomena: ["prohibition", "negation"],
    };
  }

  match = viRe(
    String.raw`^Dịch vụ\s+không\s+được(?:\s+phép)?\s+xóa\s+quá\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "constraint",
      amount,
      comparator: "at-most",
      constraintKind: "requirement",
      predicate: "concept:core.maximum-cardinality",
      phenomena: ["requirement", "negation", "comparison"],
    };
  }

  match = viRe(
    String.raw`^Nếu\s+việc\s+xóa\s+bị\s+cấm,\s*dịch vụ\s+không\s+được(?:\s+phép)?\s+xóa\s+quá\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "condition",
      amount,
      phenomena: ["condition", "requirement", "negation", "comparison"],
    };
  }

  match = viRe(
    String.raw`^Dịch vụ\s+không\s+được(?:\s+phép)?\s+xóa\s+quá\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\s+vì\s+việc\s+xóa\s+bị\s+cấm\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "cause",
      amount,
      phenomena: ["cause", "requirement", "negation", "comparison"],
    };
  }

  match = viRe(
    String.raw`^Theo\s+dịch vụ,\s*dịch vụ\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "attributed-proposition",
      amount,
      phenomena: ["simple-event", "exact-quantity", "attribution"],
    };
  }

  match = viRe(
    String.raw`^Dịch vụ\s+có\s+được(?:\s+phép)?\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\s+không\?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "question",
      amount,
      phenomena: ["question", "permission", "exact-quantity"],
    };
  }

,
    ).test(text)
  ) {
    return {
      kind: "resolved-reference",
      mention: "nó",
      phenomena: ["dialogue-reference"],
    };
  }

  match = viRe(
    String.raw`^Chỉ\s+dẫn\s+yêu\s+cầu\s+dịch\s+vụ\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?import {
  err,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import {
  buildControlledFrame,
  type ControlledCorpusParse,
  type ControlledFrame,
} from "./controlled-corpus.ts";

const integer = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const viRe = (pattern: string): RegExp =>
  new RegExp(pattern.normalize("NFC"), "iu");

const eventFrame = (
  amount: number,
  input: {
    polarity?: "positive" | "negative";
    aspect?: "completed" | "ongoing" | "planned";
    date?: string;
  } = {},
): ControlledFrame => ({
  kind: "event",
  amount,
  comparator: "exact",
  polarity: input.polarity ?? "positive",
  ...(input.aspect === undefined ? {} : { aspect: input.aspect }),
  ...(input.date === undefined ? {} : { date: input.date }),
  phenomena: [
    "simple-event",
    ...(input.polarity === "negative" ? (["negation"] as const) : []),
    "exact-quantity",
    ...(input.date === undefined ? [] : (["time"] as const)),
  ],
});

const parseVietnameseFrame = (text: string): ControlledFrame | undefined => {
  let match = viRe(
    String.raw`^Dịch vụ\s+(đã|đang|sẽ)\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[2]);
    if (amount === undefined) return undefined;
    const marker = match[1]?.normalize("NFC").toLocaleLowerCase("vi");
    const aspect =
      marker === "đã"
        ? "completed"
        : marker === "đang"
          ? "ongoing"
          : "planned";
    return eventFrame(amount, { aspect });
  }

  match = viRe(
    String.raw`^Dịch vụ\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)(?:\s+vào\s+(\d{4}-\d{2}-\d{2}))?\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return eventFrame(amount, {
      ...(match[2] === undefined ? {} : { date: match[2] }),
    });
  }

  match = viRe(
    String.raw`^Dịch vụ\s+không\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    return amount === undefined
      ? undefined
      : eventFrame(amount, { polarity: "negative" });
  }

  match = viRe(
    String.raw`^Dịch vụ\s+phải\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "constraint",
      amount,
      comparator: "exact",
      constraintKind: "requirement",
      predicate: "concept:core.requirement",
      phenomena: ["requirement", "exact-quantity"],
    };
  }

  match = viRe(
    String.raw`^Dịch vụ\s+(?:được\s+phép|có\s+thể)\s+xóa\s+(?:tối\s+đa|không\s+quá)\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "constraint",
      amount,
      comparator: "at-most",
      constraintKind: "permission",
      predicate: "concept:core.permission",
      phenomena: ["permission", "comparison"],
    };
  }

  if (
    viRe(
      String.raw`^Dịch vụ\s+không\s+được(?:\s+phép)?\s+xóa\s+(?:bất\s+kỳ\s+)?(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\s+nào\.?$`,
    ).test(text)
  ) {
    return {
      kind: "constraint",
      amount: 0,
      comparator: "at-most",
      constraintKind: "prohibition",
      predicate: "concept:core.prohibition",
      phenomena: ["prohibition", "negation"],
    };
  }

  match = viRe(
    String.raw`^Dịch vụ\s+không\s+được(?:\s+phép)?\s+xóa\s+quá\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "constraint",
      amount,
      comparator: "at-most",
      constraintKind: "requirement",
      predicate: "concept:core.maximum-cardinality",
      phenomena: ["requirement", "negation", "comparison"],
    };
  }

  match = viRe(
    String.raw`^Nếu\s+việc\s+xóa\s+bị\s+cấm,\s*dịch vụ\s+không\s+được(?:\s+phép)?\s+xóa\s+quá\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "condition",
      amount,
      phenomena: ["condition", "requirement", "negation", "comparison"],
    };
  }

  match = viRe(
    String.raw`^Dịch vụ\s+không\s+được(?:\s+phép)?\s+xóa\s+quá\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\s+vì\s+việc\s+xóa\s+bị\s+cấm\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "cause",
      amount,
      phenomena: ["cause", "requirement", "negation", "comparison"],
    };
  }

  match = viRe(
    String.raw`^Theo\s+dịch vụ,\s*dịch vụ\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\.?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "attributed-proposition",
      amount,
      phenomena: ["simple-event", "exact-quantity", "attribution"],
    };
  }

  match = viRe(
    String.raw`^Dịch vụ\s+có\s+được(?:\s+phép)?\s+xóa\s+đúng\s+(\d+)\s+(?:cái\s+)?(?:tệp(?:\s+tin)?|file)\s+không\?$`,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "question",
      amount,
      phenomena: ["question", "permission", "exact-quantity"],
    };
  }

,
  ).exec(text);
  if (match !== null) {
    const amount = integer(match[1]);
    if (amount === undefined) return undefined;
    return {
      kind: "instruction-content",
      amount,
      phenomena: ["instruction-as-content", "requirement", "exact-quantity"],
    };
  }

  return undefined;
};

export const parseControlledVietnameseCorpus = (
  input: string,
): Result<ControlledCorpusParse> => {
  const text = input.trim().normalize("NFC");
  const frame = parseVietnameseFrame(text);
  if (frame === undefined) {
    return err(
      new StructuredError(
        "GROUNDING_VI_CONTROLLED_UNSUPPORTED",
        "Câu nằm ngoài tập ngữ nghĩa tiếng Việt có kiểm soát của M8.",
      ),
    );
  }

  return buildControlledFrame({
    text,
    frame,
    languageHint: "vi",
    actorSurface: "dịch vụ",
    sourceId: "source:m8-controlled-vietnamese",
  });
};
