import type { ReactElement } from "react";

/**
Hash navigation + the IdLink pattern: every list shows the id, every id
is a link to the entity's view.

Hashes:
  #/Dashboard, #/Catalog, ...      — plain pages
  #/Catalog/4                      — page with an entity (product drill-in)
  #/Customers/ANTON                — page with an entity (customer 360)
  #/entity/Order/10856             — the generic entity detail view
*/

const PAGE_NAMES = [
	"Dashboard",
	"Catalog",
	"Orders",
	"Customers",
	"Inventory",
	"Org",
	"Suppliers",
	"Console",
	"Ops",
	"Twins",
	"Affinity",
	"Growth",
	"Shippers",
	"Reorder",
	"Exposure",
	"Journeys",
	"Links",
	"Quality",
	"Regions",
];

export type Route =
	| { kind: "page"; page: string; entityId?: string }
	| { kind: "entity"; type: string; id: string };

export function parseHash(hash: string): Route {
	const parts = hash.replace(/^#\/?/, "").split("/");

	const [first, second] = parts;

	if (first === "entity" && second !== undefined && second !== "") {
		return { kind: "entity", type: second, id: parts[2] ?? "" };
	}

	if (first !== undefined && PAGE_NAMES.includes(first)) {
		return second === undefined
			? { kind: "page", page: first }
			: { kind: "page", page: first, entityId: second };
	}

	return { kind: "page", page: "Dashboard" };
}

export function goToPage(page: string, entityId?: string): void {
	window.location.hash =
		entityId === undefined ? `#/${page}` : `#/${page}/${entityId}`;
}

export function goToEntity(type: string, id: string | number): void {
	window.location.hash = `#/entity/${type}/${id}`;
}

/**
The clickable id: label (when given) + the id, always showing the id,
always navigating to the entity's view.
*/
/** Types with a dedicated page: their links deep-link into that page. */
const PAGE_FOR_TYPE: Record<string, string> = {
	Product: "Catalog",
	Customer: "Customers",
};

export function IdLink({
	type,
	id,
	label,
}: {
	type: string;
	id: string | number;
	label?: string;
}): ReactElement {
	const page = PAGE_FOR_TYPE[type];

	return (
		<a
			onClick={() => {
				if (page !== undefined) {
					goToPage(page, String(id));
				} else {
					goToEntity(type, id);
				}
			}}
		>
			{label !== undefined ? label : `#${String(id)}`}{" "}
			<span className="muted">({String(id)})</span>
		</a>
	);
}
