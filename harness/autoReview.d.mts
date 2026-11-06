export type Review = { auto: boolean; why: string; rule?: string };
export function readOnlyCommand(words: string[]): boolean;
export function reviewCommand(command: string, rules: readonly unknown[]): Review;
export function reviewPermission(request: { command: string; tool?: string | null }, rules: readonly unknown[]): Review;
export function normalizeRule(text: string): string;
