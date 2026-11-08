import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cityCoordinates } from "./city-atlas.js";
import { durationBetween } from "../repositories/order-types.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "data");

type Row = Record<string, unknown>;

function load(name: string): Row[] {
	const parsed: unknown = JSON.parse(
		readFileSync(join(DATA_DIR, `${name}.json`), "utf8"),
	);

	if (Array.isArray(parsed)) {
		return parsed as Row[];
	}

	// The dataset wraps some files in { table: [...] }
	const firstArray = Object.values(parsed as Row).find((value) =>
		Array.isArray(value),
	);

	if (firstArray === undefined) {
		throw new Error(`Seed data ${name}.json carries no row array`);
	}

	return firstArray as Row[];
}

/** The dataset spells null as 'NULL' and ships numbers as strings. */
function text(value: unknown): string {
	if (value === undefined || value === null) {
		return "";
	}

	const asString = String(value);

	return asString.toLowerCase() === "null" ? "" : asString;
}

/**
'' → undefined: Northwind's 'NULL' fields become ABSENT properties (the
graph-natural shape), never empty strings — the embedded engine rejects
empty-string params (see relate issue: "null string value").
*/
function optionalText(value: unknown): string | undefined {
	const raw = text(value);

	return raw === "" ? undefined : raw;
}

function number(value: unknown, fallback = 0): number {
	const parsed = Number(value);

	return Number.isFinite(parsed) ? parsed : fallback;
}

/** '1996-08-01 00:00:00.000' → ISO the driver's DateTime accepts (UTC). */
function when(value: unknown): string | undefined {
	const raw = text(value);

	if (raw === "") {
		return undefined;
	}

	return `${raw.replace(" ", "T")}Z`;
}

export interface NormalizedDataset {
	regions: Row[];
	territories: { territoryID: number; name: string; regionID: number }[];
	categories: Row[];
	shippers: Row[];
	suppliers: Row[];
	employees: Row[];
	employeeTerritories: { employeeID: number; territoryID: number }[];
	employeeManagers: { employeeID: number; reportsTo: number }[];
	customers: Row[];
	products: Row[];
	orders: {
		orderID: number;
		orderDate: string | undefined;
		requiredDate: string | undefined;
		shippedDate: string | undefined;
		timeToShip:
			| { months: number; days: number; seconds: number; nanoseconds: number }
			| undefined;
		freight: number;
		shipName: string;
		shipStreet: string | undefined;
		shipCity: string;
		shipRegion: string | undefined;
		shipPostalCode: string | undefined;
		shipCountry: string;
		customerID: string;
		employeeID: number;
		shipperID: number;
	}[];
	orderLines: {
		orderID: number;
		productID: number;
		unitPrice: number;
		quantity: number;
		discount: number;
	}[];
}

export function loadDataset(): NormalizedDataset {
	const regions = load("regions");
	const territories: NormalizedDataset["territories"] = [];

	for (const region of regions) {
		const regionID = number(region["regionID"]);
		const embedded = region["territories"];

		if (Array.isArray(embedded)) {
			for (const territory of embedded as Row[]) {
				territories.push({
					territoryID: number(territory["territoryID"]),
					name: text(territory["name"]),
					regionID,
				});
			}
		}
	}

	const employees = load("employees");
	const employeeTerritories: NormalizedDataset["employeeTerritories"] = [];
	const employeeManagers: NormalizedDataset["employeeManagers"] = [];

	for (const employee of employees) {
		const employeeID = number(employee["employeeID"]);

		const ids = employee["territoryIDs"];
		if (Array.isArray(ids)) {
			for (const territoryID of ids) {
				employeeTerritories.push({
					employeeID,
					territoryID: number(territoryID),
				});
			}
		}

		const reportsTo = text(employee["reportsTo"]);
		if (reportsTo !== "") {
			employeeManagers.push({ employeeID, reportsTo: number(reportsTo) });
		}
	}

	const orders: NormalizedDataset["orders"] = [];
	const orderLines: NormalizedDataset["orderLines"] = [];

	for (const raw of load("orders")) {
		const orderID = number(raw["orderID"]);
		const orderDate = when(raw["orderDate"]);
		const shippedDate = when(raw["shippedDate"]);

		orders.push({
			orderID,
			orderDate,
			requiredDate: when(raw["requiredDate"]),
			shippedDate,
			timeToShip:
				orderDate !== undefined && shippedDate !== undefined
					? durationBetween(orderDate, shippedDate)
					: undefined,
			freight: number(raw["freight"]),
			shipName: text(raw["shipName"]),
			shipStreet: optionalText(
				(raw["shipAddress"] as Row | undefined)?.["street"],
			),
			shipCity: text((raw["shipAddress"] as Row | undefined)?.["city"]),
			shipRegion: optionalText(
				(raw["shipAddress"] as Row | undefined)?.["region"],
			),
			shipPostalCode: optionalText(
				(raw["shipAddress"] as Row | undefined)?.["postalCode"],
			),
			shipCountry: text((raw["shipAddress"] as Row | undefined)?.["country"]),
			customerID: text(raw["customerID"]),
			employeeID: number(raw["employeeID"]),
			shipperID: number(raw["shipVia"]),
		});

		const details = raw["details"];
		if (Array.isArray(details)) {
			for (const detail of details as Row[]) {
				orderLines.push({
					orderID,
					productID: number(detail["productID"]),
					unitPrice: number(detail["unitPrice"]),
					quantity: number(detail["quantity"]),
					discount: number(detail["discount"]),
				});
			}
		}
	}

	const suppliers = load("suppliers").map((supplier) => {
		const address = (supplier["address"] ?? {}) as Row;

		return {
			supplierID: number(supplier["supplierID"]),
			companyName: text(supplier["companyName"]),
			contactName: text(supplier["contactName"]),
			contactTitle: text(supplier["contactTitle"]),
			street: optionalText(address["street"]),
			city: text(address["city"]),
			region: optionalText(address["region"]),
			postalCode: optionalText(address["postalCode"]),
			country: text(address["country"]),
			phone: optionalText(address["phone"]),
			location: cityCoordinates(text(address["city"])),
		};
	});

	const customers = load("customers").map((customer) => {
		const address = (customer["address"] ?? {}) as Row;

		return {
			customerID: text(customer["customerID"]),
			companyName: text(customer["companyName"]),
			contactName: text(customer["contactName"]),
			contactTitle: text(customer["contactTitle"]),
			street: optionalText(address["street"]),
			city: text(address["city"]),
			region: optionalText(address["region"]),
			postalCode: optionalText(address["postalCode"]),
			country: text(address["country"]),
			phone: optionalText(address["phone"]),
		};
	});

	const products = load("products").map((product) => ({
		productID: number(product["productID"]),
		name: text(product["name"]),
		quantityPerUnit: text(product["quantityPerUnit"]),
		unitPrice: number(product["unitPrice"]),
		unitsInStock: number(product["unitsInStock"]),
		unitsOnOrder: number(product["unitsOnOrder"]),
		reorderLevel: number(product["reorderLevel"]),
		discontinued: Boolean(product["discontinued"]),
		supplierID: number(product["supplierID"]),
		categoryID: number(product["categoryID"]),
	}));

	return {
		regions: regions.map((region) => ({
			regionID: number(region["regionID"]),
			name: text(region["name"]),
		})),
		territories,
		categories: load("categories").map((category) => ({
			categoryID: number(category["categoryID"]),
			name: text(category["name"]),
			description: text(category["description"]),
		})),
		shippers: load("shippers").map((shipper) => ({
			shipperID: number(shipper["shipperID"]),
			companyName: text(shipper["companyName"]),
			phone: text(shipper["phone"]),
		})),
		suppliers,
		employees: employees.map((employee) => {
			const address = (employee["address"] ?? {}) as Row;

			return {
				employeeID: number(employee["employeeID"]),
				lastName: text(employee["lastName"]),
				firstName: text(employee["firstName"]),
				title: text(employee["title"]),
				titleOfCourtesy: text(employee["titleOfCourtesy"]),
				birthDate: (when(employee["birthDate"]) ?? "1900-01-01").slice(0, 10),
				hireDate: (when(employee["hireDate"]) ?? "1990-01-01").slice(0, 10),
				street: text(address["street"]),
				city: text(address["city"]),
				postalCode: text(address["postalCode"]),
				country: text(address["country"]),
				phone: text(address["phone"]),
				notes: text(employee["notes"]),
				reportsTo: optionalText(employee["reportsTo"]),
			};
		}),
		employeeTerritories,
		employeeManagers,
		customers,
		products,
		orders,
		orderLines,
	};
}
