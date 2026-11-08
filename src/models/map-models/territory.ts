import { defineModel } from "neode";

/**
Territory is defined through the MAP API (neode parity), not decorators —
proof that both definition front doors share one metamodel registry, and
the model `withDirectory()` loads at boot. IN_REGION wires each territory
to its Region.
*/
export const Territory = defineModel("Territory", {
	description: "A sales territory",
	territoryID: {
		type: "number",
		primary: true,
		description: "Northwind territory id",
	},
	name: { type: "string" },
	IN_REGION: {
		type: "relationships",
		relationship: "IN_REGION",
		direction: "out",
		target: "Region",
	},
});
