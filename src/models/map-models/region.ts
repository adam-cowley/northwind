import { defineModel } from "neode";

/** Region, map-API (see territory.ts for why). */
export const Region = defineModel("Region", {
	description: "A sales region grouping territories",
	regionID: {
		type: "number",
		primary: true,
		description: "Northwind region id",
	},
	name: { type: "string" },
});
