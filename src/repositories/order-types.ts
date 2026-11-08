import { NeodeError } from "neode";

/** Requested quantity exceeds stock — a domain 409, like OptimisticLockError. */
export class OutOfStockError extends NeodeError {
	readonly productID: number;

	constructor(productID: number, requested: number, available: number) {
		super(
			`Product ${productID}: requested ${requested}, only ${available} in stock`,
		);
		this.productID = productID;
	}
}

export interface PlaceOrderItem {
	productID: number;
	quantity: number;
	discount?: number;
}

export interface PlaceOrderInput {
	customerID: string;
	employeeID: number;
	shipperID: number;
	items: PlaceOrderItem[];
}

/**
The library's Duration value shape from two ISO timestamps, minute
precision: { months, days, seconds, nanoseconds }
*/
export function durationBetween(
	from: string,
	to: string,
): {
	months: number;
	days: number;
	seconds: number;
	nanoseconds: number;
} {
	const totalSeconds = Math.max(
		0,
		Math.floor((Date.parse(to) - Date.parse(from)) / 1000),
	);

	const days = Math.floor(totalSeconds / 86400);
	const seconds = totalSeconds % 86400;

	return { months: 0, days, seconds, nanoseconds: 0 };
}
