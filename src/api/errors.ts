import type { Context, Next } from "hono";
import { OutOfStockError } from "../repositories/order-types.js";
import {
	ConstraintViolationError,
	NeodeError,
	OptimisticLockError,
	ValidationError,
	classifyError,
	isTransientError,
} from "neode";

/**
The API's error mapping (typed taxonomy → HTTP), shared by the main app
and every mounted insight sub-app — Hono error scopes do not cross
app.route() boundaries, so each mounted app carries this itself.
*/
export function mapApiError(error: unknown, context: Context): Response {
	if (error instanceof ValidationError) {
		return context.json(
			{ error: "validation_failed", details: error.details },
			422,
		);
	}

	if (
		error instanceof OptimisticLockError ||
		error instanceof OutOfStockError ||
		error instanceof ConstraintViolationError
	) {
		return context.json({ error: "conflict", message: error.message }, 409);
	}

	if (isTransientError(error)) {
		return context.json({ error: "transient", message: error.message }, 503);
	}

	if (error instanceof NeodeError) {
		return context.json({ error: "bad_request", message: error.message }, 400);
	}

	// The escape hatch of the taxonomy: classify anything else — typed
	// errors pass through, unknowns stay unknown but named
	const classified = classifyError(error);

	console.error(classified ?? error);

	return context.json({ error: "internal" }, 500);
}

/** Attach the shared error map to a sub-app. */
export function withErrorMap<
	T extends {
		onError: (
			handler: (error: unknown, context: Context, next?: Next) => Response,
		) => T;
	},
>(routes: T): T {
	return routes.onError(mapApiError);
}
