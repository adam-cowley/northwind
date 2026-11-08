import { it } from "vitest";
import { openBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import Neode from "neode";
import { Product } from "../../src/models/product.js";

it("probe import failure", async () => {
	const backend = await openBackend();
	const neode: Neode = backend.neode;
	await seed(neode);

	try {
		const { instrumentConnectionProvider } = await import("neode");
		const instrumented = (neode as unknown as { connection: unknown })
			.connection;
		void instrumented;
		const chunks = await neode.mergeMany(Product, [
			{
				productID: 9001,
				name: "Imported Ale",
				supplierID: 1,
				unitPrice: 9.5,
				unitsInStock: 10,
				unitsOnOrder: 0,
				reorderLevel: 5,
				discontinued: false,
				quantityPerUnit: "24 bottles",
			},
		]);
		console.log("import OK:", chunks.length);
	} catch (problem) {
		console.log("import FAILED:", JSON.stringify((problem as Error).message));
	}

	await backend.close();
}, 120000);
