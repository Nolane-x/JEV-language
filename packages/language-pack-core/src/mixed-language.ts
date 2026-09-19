export type BorrowingStrategy =
  | "borrow-source"
  | "transliterate"
  | "descriptive-phrase"
  | "retain-technical-symbol"
  | "unsupported";

export interface BorrowingRequest {
  sourceSurface: string;
  targetLanguage: string;
  sourceLanguage?: string;
  technicalSymbol?: string;
  transliteration?: string;
  descriptivePhrase?: string;
  domain?: string;
  style?: string;
}

export interface BorrowingDecision {
  status: "resolved" | "unsupported";
  strategy: BorrowingStrategy;
  targetLanguage: string;
  surface?: string;
  sourceLanguage?: string;
  deliberateLanguageSwitch: boolean;
  evidence: string[];
}

export interface BorrowingPolicy {
  readonly id: string;
  readonly targetLanguage: string;
  resolve(request: BorrowingRequest): BorrowingDecision;
}

export interface ConfiguredBorrowingPolicyOptions {
  id: string;
  targetLanguage: string;
  strategyOrder: Exclude<BorrowingStrategy, "unsupported">[];
  allowedSourceLanguages?: string[];
  allowedDomains?: string[];
}

const unsupported = (
  request: BorrowingRequest,
  policyId: string,
): BorrowingDecision => ({
  status: "unsupported",
  strategy: "unsupported",
  targetLanguage: request.targetLanguage,
  ...(request.sourceLanguage === undefined
    ? {}
    : { sourceLanguage: request.sourceLanguage }),
  deliberateLanguageSwitch: false,
  evidence: [
    `policy:${policyId}`,
    "borrowing:no-explicit-safe-strategy",
  ],
});

export class ConfiguredBorrowingPolicy
  implements BorrowingPolicy
{
  readonly id: string;
  readonly targetLanguage: string;
  readonly #strategyOrder: Exclude<
    BorrowingStrategy,
    "unsupported"
  >[];
  readonly #allowedSourceLanguages?: Set<string>;
  readonly #allowedDomains?: Set<string>;

  constructor(options: ConfiguredBorrowingPolicyOptions) {
    if (
      options.id.trim() === "" ||
      options.targetLanguage.trim() === ""
    ) {
      throw new Error(
        "Borrowing policy requires a non-empty id and target language.",
      );
    }
    if (options.strategyOrder.length === 0) {
      throw new Error(
        "Borrowing policy requires at least one explicit strategy.",
      );
    }
    if (
      new Set(options.strategyOrder).size !==
      options.strategyOrder.length
    ) {
      throw new Error(
        "Borrowing policy strategy order must not contain duplicates.",
      );
    }

    this.id = options.id;
    this.targetLanguage = options.targetLanguage;
    this.#strategyOrder = [...options.strategyOrder];
    this.#allowedSourceLanguages =
      options.allowedSourceLanguages === undefined
        ? undefined
        : new Set(options.allowedSourceLanguages);
    this.#allowedDomains =
      options.allowedDomains === undefined
        ? undefined
        : new Set(options.allowedDomains);
  }

  resolve(request: BorrowingRequest): BorrowingDecision {
    if (request.targetLanguage !== this.targetLanguage) {
      return unsupported(request, this.id);
    }
    if (
      this.#allowedDomains !== undefined &&
      request.domain !== undefined &&
      !this.#allowedDomains.has(request.domain)
    ) {
      return unsupported(request, this.id);
    }

    for (const strategy of this.#strategyOrder) {
      switch (strategy) {
        case "retain-technical-symbol":
          if (
            request.technicalSymbol !== undefined &&
            request.technicalSymbol.trim() !== ""
          ) {
            return {
              status: "resolved",
              strategy,
              targetLanguage: this.targetLanguage,
              surface: request.technicalSymbol,
              ...(request.sourceLanguage === undefined
                ? {}
                : { sourceLanguage: request.sourceLanguage }),
              deliberateLanguageSwitch:
                request.sourceLanguage !== undefined &&
                request.sourceLanguage !== this.targetLanguage,
              evidence: [
                `policy:${this.id}`,
                "borrowing:explicit-technical-symbol",
              ],
            };
          }
          break;

        case "transliterate":
          if (
            request.transliteration !== undefined &&
            request.transliteration.trim() !== ""
          ) {
            return {
              status: "resolved",
              strategy,
              targetLanguage: this.targetLanguage,
              surface: request.transliteration,
              ...(request.sourceLanguage === undefined
                ? {}
                : { sourceLanguage: request.sourceLanguage }),
              deliberateLanguageSwitch: false,
              evidence: [
                `policy:${this.id}`,
                "borrowing:explicit-transliteration",
              ],
            };
          }
          break;

        case "descriptive-phrase":
          if (
            request.descriptivePhrase !== undefined &&
            request.descriptivePhrase.trim() !== ""
          ) {
            return {
              status: "resolved",
              strategy,
              targetLanguage: this.targetLanguage,
              surface: request.descriptivePhrase,
              ...(request.sourceLanguage === undefined
                ? {}
                : { sourceLanguage: request.sourceLanguage }),
              deliberateLanguageSwitch: false,
              evidence: [
                `policy:${this.id}`,
                "borrowing:configured-description",
              ],
            };
          }
          break;

        case "borrow-source": {
          const sourceLanguage = request.sourceLanguage;
          const allowed =
            sourceLanguage !== undefined &&
            sourceLanguage !== this.targetLanguage &&
            (this.#allowedSourceLanguages === undefined ||
              this.#allowedSourceLanguages.has(sourceLanguage));
          if (allowed && request.sourceSurface.trim() !== "") {
            return {
              status: "resolved",
              strategy,
              targetLanguage: this.targetLanguage,
              surface: request.sourceSurface,
              sourceLanguage,
              deliberateLanguageSwitch: true,
              evidence: [
                `policy:${this.id}`,
                `borrowing:explicit-source:${sourceLanguage}`,
              ],
            };
          }
          break;
        }
      }
    }

    return unsupported(request, this.id);
  }
}

export const validateMixedLanguagePolicy = (input: {
  languageTag: string;
  mixedLanguage: boolean;
  borrowing?: BorrowingPolicy;
}): void => {
  if (!input.mixedLanguage) return;
  if (input.borrowing === undefined) {
    throw new Error(
      `Language pack ${input.languageTag} declares mixed-language support without an explicit borrowing policy.`,
    );
  }
  if (input.borrowing.targetLanguage !== input.languageTag) {
    throw new Error(
      `Borrowing policy target ${input.borrowing.targetLanguage} does not match language pack ${input.languageTag}.`,
    );
  }
};
