/**
 * Reads an integer query parameter. A missing or non-numeric value gives the
 * fallback, and the result is clamped to [min, max]. A bare `Math.min(Number(v), max)`
 * lets `-1` and `NaN` through, and SQLite reads `LIMIT -1` as "no limit".
 */
export function clampIntParam(value: string | null, fallback: number, min: number, max: number): number {
	const parsed = value === null || value.trim() === "" ? Number.NaN : Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(Math.max(Math.trunc(parsed), min), max);
}
