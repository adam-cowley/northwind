import type { Context } from "hono";

/**
Integer query param (NTS-556): `Number(...)` with a floor — garbage like
`?limit=abc` falls back to the default instead of NaN-skewing skip/limit.
Truncates fractions and clamps negatives to 0.
*/
export function intQuery(
	context: Context,
	name: string,
	fallback: number,
): number {
	const raw = Number(context.req.query(name) ?? fallback);

	return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : fallback;
}
