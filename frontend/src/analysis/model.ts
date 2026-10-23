import type {
  Analysis,
  Card,
  Engine,
  Report,
  Row,
  Score,
  Answer,
  Change,
} from "../types";
export type { Analysis, Engine, Report, Row, Score, Answer, Change };
export type CardData = Omit<Card, "tags" | "quantity"> & {
  id?: string;
  oracle_id?: string;
  mana_cost?: string;
  colors: string[];
  color_identity: string[];
  keywords: string[];
  legalities: Record<string, string>;
  prices: Record<string, string | null>;
  reserved?: boolean;
  game_changer?: boolean;
  layout?: string;
  scryfall_uri?: string;
};
export type TaggedCard = CardData & {
  tags: Record<string, string[]>;
  quantity: number;
  is_commander: boolean;
};
export type DeckAnalysis = Omit<Analysis, "cards" | "confidence"> & {
  cards: TaggedCard[];
  identity: string[];
  identity_known: boolean;
  confidence: Analysis["confidence"] & { index: number; completeness: number };
  validity_warnings: number;
  coverage_observation_fraction: number;
};
export type DeckInput = { name?: string; text: string; commander?: string };
export interface CardStore {
  cached(name: string): Promise<{ hit: boolean; card: CardData | null }>;
  cache(name: string, card: CardData | null): Promise<void>;
}
export interface CardProvider {
  store: CardStore;
  prefetch(names: string[]): Promise<void>;
  resolve(name: string): Promise<[CardData | null, string]>;
}
export type Matchup = Report["matchup"] & {
  rows: (Row & { threat_range: number[] })[];
};
// Match Python's round-to-even behaviour, including decimal halfway values.
export function round(value: number, digits = 0): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const negative = value < 0;
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, Math.abs(value));
  const bits = bytes.getBigUint64(0),
    exponent = Number((bits >> 52n) & 2047n),
    fraction = bits & ((1n << 52n) - 1n);
  let numerator = exponent ? fraction + (1n << 52n) : fraction;
  let denominator = 1n;
  const power = (exponent ? exponent - 1023 : 1 - 1023) - 52;
  if (power >= 0) numerator <<= BigInt(power);
  else denominator <<= BigInt(-power);
  numerator *= 10n ** BigInt(digits);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (
    remainder * 2n > denominator ||
    (remainder * 2n === denominator && quotient % 2n === 1n)
  )
    quotient++;
  return ((negative ? -1 : 1) * Number(quotient)) / 10 ** digits;
}
export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
export const unique = <T>(values: T[]) => [...new Set(values)];
export const subset = (values: string[], allowed: string[]) =>
  values.every((v) => allowed.includes(v));
