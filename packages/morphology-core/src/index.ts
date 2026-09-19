import type { SemanticId } from "../../core-types/src/index.ts";
import {
  LexiconIndex,
  caseFoldLexicalSurface,
  type Lexeme,
  type LexemeId,
  type PartOfSpeech,
} from "../../lexicon-core/src/index.ts";

export type MorphNumber = "singular" | "plural";
export type MorphPerson = 1 | 2 | 3;
export type MorphTense = "present" | "past";
export type MorphAspect = "simple" | "progressive" | "perfect";
export type MorphMood = "indicative" | "imperative" | "subjunctive";
export type MorphVoice = "active" | "passive";
export type MorphDegree = "positive" | "comparative" | "superlative";
export type VerbForm =
  | "base"
  | "third-person-singular"
  | "past"
  | "past-participle"
  | "present-participle";

export interface MorphFeatures {
  number?: MorphNumber;
  person?: MorphPerson;
  tense?: MorphTense;
  aspect?: MorphAspect;
  mood?: MorphMood;
  voice?: MorphVoice;
  degree?: MorphDegree;
  verbForm?: VerbForm;
  definiteness?: "definite" | "indefinite";
  politeness?: string;
  classifier?: SemanticId;
}

export interface MorphContext {
  language?: string;
  expectedPartOfSpeech?: PartOfSpeech;
}

export interface MorphAnalysis {
  lexemeId: LexemeId;
  lemma: string;
  partOfSpeech: PartOfSpeech;
  features: MorphFeatures;
  confidence: number;
  source: "deterministic";
}

export interface SurfaceCandidate {
  surface: string;
  lexemeId: LexemeId;
  features: MorphFeatures;
  confidence: number;
  source: "deterministic";
}

export interface MorphologyProvider {
  readonly id: string;
  readonly language: string;
  analyze(surface: string, context?: MorphContext): MorphAnalysis[];
  realize(lemma: LexemeId, features: MorphFeatures): SurfaceCandidate[];
}

interface IrregularVerbForms {
  third?: string;
  past: string;
  pastParticiple: string;
  presentParticiple?: string;
}

const irregularNounPlural: Readonly<Record<string, string>> = {
  child: "children",
  person: "people",
  mouse: "mice",
  foot: "feet",
  tooth: "teeth",
  man: "men",
  woman: "women",
};

const irregularVerbs: Readonly<Record<string, IrregularVerbForms>> = {
  be: {
    third: "is",
    past: "was",
    pastParticiple: "been",
    presentParticiple: "being",
  },
  have: {
    third: "has",
    past: "had",
    pastParticiple: "had",
    presentParticiple: "having",
  },
  do: {
    third: "does",
    past: "did",
    pastParticiple: "done",
    presentParticiple: "doing",
  },
  go: {
    third: "goes",
    past: "went",
    pastParticiple: "gone",
    presentParticiple: "going",
  },
  build: {
    past: "built",
    pastParticiple: "built",
    presentParticiple: "building",
  },
  take: {
    past: "took",
    pastParticiple: "taken",
    presentParticiple: "taking",
  },
  give: {
    past: "gave",
    pastParticiple: "given",
    presentParticiple: "giving",
  },
};

const isConsonant = (character: string | undefined): boolean =>
  character !== undefined && /^[bcdfghjklmnpqrstvwxyz]$/i.test(character);

const pluralizeEnglishNoun = (lemma: string): string => {
  const lower = lemma.toLowerCase();
  const irregular = irregularNounPlural[lower];
  if (irregular !== undefined) return irregular;
  if (/[^aeiou]y$/i.test(lemma)) return `${lemma.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/i.test(lemma)) return `${lemma}es`;
  return `${lemma}s`;
};

const thirdPersonEnglishVerb = (lemma: string): string => {
  const irregular = irregularVerbs[lemma.toLowerCase()]?.third;
  if (irregular !== undefined) return irregular;
  if (/[^aeiou]y$/i.test(lemma)) return `${lemma.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh|o)$/i.test(lemma)) return `${lemma}es`;
  return `${lemma}s`;
};

const regularPast = (lemma: string): string => {
  if (/e$/i.test(lemma)) return `${lemma}d`;
  if (/[^aeiou]y$/i.test(lemma)) return `${lemma.slice(0, -1)}ied`;
  return `${lemma}ed`;
};

const pastEnglishVerb = (lemma: string): string =>
  irregularVerbs[lemma.toLowerCase()]?.past ?? regularPast(lemma);

const pastParticipleEnglishVerb = (lemma: string): string =>
  irregularVerbs[lemma.toLowerCase()]?.pastParticiple ?? regularPast(lemma);

const presentParticipleEnglishVerb = (lemma: string): string => {
  const irregular = irregularVerbs[lemma.toLowerCase()]?.presentParticiple;
  if (irregular !== undefined) return irregular;
  if (/ie$/i.test(lemma)) return `${lemma.slice(0, -2)}ying`;
  if (/[^e]e$/i.test(lemma)) return `${lemma.slice(0, -1)}ing`;
  const chars = [...lemma];
  const last = chars.at(-1);
  const middle = chars.at(-2);
  const first = chars.at(-3);
  if (
    lemma.length <= 5 &&
    isConsonant(first) &&
    middle !== undefined &&
    /^[aeiou]$/i.test(middle) &&
    isConsonant(last) &&
    !/[wxy]/i.test(last ?? "")
  ) {
    return `${lemma}${last}ing`;
  }
  return `${lemma}ing`;
};

const adjectiveDegree = (
  lemma: string,
  degree: MorphDegree,
): string => {
  if (degree === "positive") return lemma;
  const long = lemma.length > 6 || lemma.includes("-");
  if (long) {
    return degree === "comparative" ? `more ${lemma}` : `most ${lemma}`;
  }
  if (/y$/i.test(lemma)) {
    return degree === "comparative"
      ? `${lemma.slice(0, -1)}ier`
      : `${lemma.slice(0, -1)}iest`;
  }
  if (/e$/i.test(lemma)) {
    return degree === "comparative" ? `${lemma}r` : `${lemma}st`;
  }
  return degree === "comparative" ? `${lemma}er` : `${lemma}est`;
};

const requestedVerbForm = (features: MorphFeatures): VerbForm => {
  if (features.verbForm !== undefined) return features.verbForm;
  if (features.aspect === "progressive") return "present-participle";
  if (features.aspect === "perfect") return "past-participle";
  if (features.tense === "past") return "past";
  if (
    features.tense === "present" &&
    features.person === 3 &&
    features.number === "singular"
  ) {
    return "third-person-singular";
  }
  return "base";
};

const realizeEnglishLexeme = (
  lexeme: Lexeme,
  features: MorphFeatures,
): string | undefined => {
  switch (lexeme.partOfSpeech) {
    case "noun":
      return features.number === "plural"
        ? pluralizeEnglishNoun(lexeme.lemma)
        : lexeme.lemma;
    case "verb":
    case "auxiliary": {
      switch (requestedVerbForm(features)) {
        case "base":
          return lexeme.lemma;
        case "third-person-singular":
          return thirdPersonEnglishVerb(lexeme.lemma);
        case "past":
          return pastEnglishVerb(lexeme.lemma);
        case "past-participle":
          return pastParticipleEnglishVerb(lexeme.lemma);
        case "present-participle":
          return presentParticipleEnglishVerb(lexeme.lemma);
      }
    }
    case "adjective":
    case "adverb":
      return adjectiveDegree(lexeme.lemma, features.degree ?? "positive");
    default:
      return lexeme.lemma;
  }
};

const analysisFeatureCandidates = (lexeme: Lexeme): MorphFeatures[] => {
  switch (lexeme.partOfSpeech) {
    case "noun":
      return [{ number: "singular" }, { number: "plural" }];
    case "verb":
    case "auxiliary":
      return [
        { verbForm: "base" },
        { verbForm: "third-person-singular", person: 3, number: "singular" },
        { verbForm: "past", tense: "past" },
        { verbForm: "past-participle", aspect: "perfect" },
        { verbForm: "present-participle", aspect: "progressive" },
      ];
    case "adjective":
    case "adverb":
      return [
        { degree: "positive" },
        { degree: "comparative" },
        { degree: "superlative" },
      ];
    default:
      return [{}];
  }
};

export class EnglishMorphologyProvider implements MorphologyProvider {
  readonly id = "morphology.en.deterministic.v1";
  readonly language = "en";

  constructor(readonly lexicon: LexiconIndex) {}

  analyze(surface: string, context: MorphContext = {}): MorphAnalysis[] {
    if (context.language !== undefined && context.language !== this.language) {
      return [];
    }
    const normalized = caseFoldLexicalSurface(surface, this.language);
    const output: MorphAnalysis[] = [];
    const seen = new Set<string>();

    for (const lexeme of this.lexicon.allLexemes(this.language)) {
      if (
        context.expectedPartOfSpeech !== undefined &&
        lexeme.partOfSpeech !== context.expectedPartOfSpeech
      ) {
        continue;
      }
      for (const features of analysisFeatureCandidates(lexeme)) {
        const realized = realizeEnglishLexeme(lexeme, features);
        if (
          realized === undefined ||
          caseFoldLexicalSurface(realized, this.language) !== normalized
        ) {
          continue;
        }
        const key = `${lexeme.id}\u0000${JSON.stringify(features)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push({
          lexemeId: lexeme.id,
          lemma: lexeme.lemma,
          partOfSpeech: lexeme.partOfSpeech,
          features,
          confidence: 1,
          source: "deterministic",
        });
      }
    }

    return output.sort((a, b) => a.lexemeId.localeCompare(b.lexemeId));
  }

  realize(lemma: LexemeId, features: MorphFeatures): SurfaceCandidate[] {
    const lexeme = this.lexicon.get(lemma);
    if (lexeme === undefined || lexeme.language !== this.language) return [];
    const surface = realizeEnglishLexeme(lexeme, features);
    if (surface === undefined) return [];
    return [
      {
        surface,
        lexemeId: lexeme.id,
        features: structuredClone(features),
        confidence: 1,
        source: "deterministic",
      },
    ];
  }
}
