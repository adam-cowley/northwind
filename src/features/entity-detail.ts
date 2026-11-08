import { Hono } from "hono";
import { withErrorMap } from "../api/errors.js";
import type Neode from "neode";
import { Builder, NeodeError, jsonSafe } from "neode";

/**
The generic entity view (the "ID in the list" pattern): any registered
type, its properties and its 1-hop typed neighborhood, with neighbor
types resolved so the UI can link every id.

Type → primary key + display keys (NTS-556): the canonical type names
used in URLs. One map so the pk and the display keys cannot drift.
*/
const TYPES: Record<string, { pk: string; label: string[] }> = {
	Product: { pk: "productID", label: ["name"] },
	Customer: { pk: "customerID", label: ["companyName"] },
	Order: { pk: "orderID", label: ["orderID"] },
	Supplier: { pk: "supplierID", label: ["companyName"] },
	Employee: { pk: "employeeID", label: ["firstName", "lastName"] },
	Shipper: { pk: "shipperID", label: ["companyName"] },
	Region: { pk: "regionID", label: ["name"] },
	Territory: { pk: "territoryID", label: ["name"] },
	Category: { pk: "categoryID", label: ["name"] },
};

/** The display string for a node of the given type. */
function displayFor(
	type: string | undefined,
	properties: Record<string, unknown>,
): string {
	if (type === undefined) {
		return "?";
	}

	const keys = TYPES[type]?.label ?? ["name"];

	if (type === "Order") {
		return `#${String(properties["orderID"])}`;
	}

	const parts = keys
		.map((key) => properties[key])
		.filter((value) => value !== null && value !== undefined)
		.map(String);

	return parts.length > 0 ? parts.join(" ") : "?";
}

/** The canonical type for a node's labels (most specific wins). */
function typeForLabels(labels: unknown): string | undefined {
	if (!Array.isArray(labels)) {
		return undefined;
	}

	for (const candidate of Object.keys(TYPES)) {
		if (labels.includes(candidate)) {
			return candidate;
		}
	}

	return undefined;
}

export function createEntityDetailRoutes(neode: Neode): Hono {
	const routes = withErrorMap(new Hono());

	routes.get("/:type/:id", async (context) => {
		const type = context.req.param("type");
		const rawId = context.req.param("id");

		const pk = TYPES[type]?.pk;

		if (pk === undefined) {
			throw new NeodeError(`Unknown entity type "${type}"`);
		}

		const id = /^\d+$/.test(rawId) ? Number(rawId) : rawId;

		const builder = new Builder();

		builder.match("n", type, { [pk]: id });

		builder
			.optionalMatch("n")
			.relationship(undefined, "out", "rout")
			.to("mout");
		builder.with("n", "rout", "mout");
		builder.optionalMatch("n").relationship(undefined, "in", "rin").to("min");

		builder.return(
			"n AS node",
			"rout AS rout",
			"mout AS mout",
			"rin AS rin",
			"min AS min",
		);
		builder.limit(100);

		const { query, params } = builder.build();
		const output = await neode.readCypher(query, params);

		const first = output.records[0];

		if (first === undefined) {
			return context.json({ error: "not_found" }, 404);
		}

		const node = jsonSafe(first.get("node")) as {
			properties?: Record<string, unknown>;
			labels?: string[];
		};

		const properties = node.properties ?? {};

		const edges: {
			relType: string;
			direction: "out" | "in";
			neighborType: string | undefined;
			neighborId: unknown;
			neighborDisplay: string;
		}[] = [];

		const seen = new Set<string>();

		for (const row of output.records) {
			for (const [relKey, nodeKey, direction] of [
				["rout", "mout", "out"],
				["rin", "min", "in"],
			] as const) {
				const rel = row.get(relKey) as
					| { type?: string; elementId?: string }
					| undefined;
				const neighbor = row.get(nodeKey) as
					| {
							labels?: string[];
							properties?: Record<string, unknown>;
							elementId?: string;
					  }
					| undefined;

				if (
					rel === undefined ||
					rel === null ||
					neighbor === undefined ||
					neighbor === null
				) {
					continue;
				}

				// Repeated rows duplicate edges; elementIds dedupe them
				const edgeId = `${direction}:${rel.elementId ?? ""}:${neighbor.elementId ?? ""}`;

				if (seen.has(edgeId)) {
					continue;
				}

				seen.add(edgeId);

				const neighborType = typeForLabels(neighbor.labels);

				edges.push({
					relType: String(rel.type ?? ""),
					direction,
					neighborType,
					neighborId:
						neighbor.properties?.[TYPES[neighborType ?? ""]?.pk ?? ""],
					neighborDisplay: displayFor(neighborType, neighbor.properties ?? {}),
				});
			}
		}

		return context.json({
			type,
			id: properties[pk],
			display: displayFor(type, properties),
			properties,
			edges,
		});
	});

	return routes;
}
