import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { openBackend } from "../support/backend.js";
import { seed } from "../../src/seed/seed.js";
import { createExpressApp } from "../../src/express/api.js";
import type { Neode } from "neode";

/**
The neode/express router over the Northwind models: every model gets
CRUD generated from its definition, no hand-written routes involved.
*/
describe("Express generated API", () => {
	let neode: Neode;
	let app: Express;

	beforeAll(async () => {
		const backend = await openBackend();
		neode = backend.neode;
		await seed(neode);

		app = createExpressApp(neode);
	}, 300000);

	it("self-describes through the ontology index", async () => {
		const response = await request(app).get("/api");

		expect(response.status).toBe(200);
		const names = response.body.entities.map(
			(entity: { name: string }) => entity.name,
		);
		expect(names).toEqual(
			expect.arrayContaining([
				"Product",
				"Order",
				"OrderLine",
				"Customer",
				"Supplier",
				"Region", // map-defined model — same registry, same routes
			]),
		);
	});

	it("lists with pagination and equality filters", async () => {
		const all = await request(app).get("/api/Product?limit=5");

		expect(all.status).toBe(200);
		expect(all.body.total).toBeGreaterThan(0);
		expect(all.body.items).toHaveLength(5);
		expect(all.body.items[0].productID).toBeDefined();

		const filtered = await request(app).get(
			`/api/Product?productID=${all.body.items[0].productID}`,
		);

		expect(filtered.body.total).toBe(1);
	});

	it("round-trips an entity: create, read, update, delete", async () => {
		const created = await request(app).post("/api/Supplier").send({
			supplierID: 9999,
			companyName: "Generated Ltd",
			contactName: "Router Test",
			contactTitle: "QA",
			street: "1 Generated Way",
			city: "Testville",
			postalCode: "00000",
			country: "Testland",
			phone: "555-0100",
		});

		expect(created.status).toBe(201);
		expect(created.body.supplierID).toBe(9999);

		const read = await request(app).get("/api/Supplier/9999");
		expect(read.status).toBe(200);
		expect(read.body.companyName).toBe("Generated Ltd");

		const updated = await request(app).patch("/api/Supplier/9999").send({
			country: "Updatedland",
		});
		expect(updated.status).toBe(200);
		expect(updated.body.country).toBe("Updatedland");

		const deleted = await request(app).delete("/api/Supplier/9999");
		expect(deleted.status).toBe(204);

		const gone = await request(app).get("/api/Supplier/9999");
		expect(gone.status).toBe(404);
	});

	it("rejects an invalid body with 422 and details", async () => {
		const response = await request(app)
			.post("/api/Product")
			.send({ productID: 9999, unitPrice: "not-a-number" });

		expect(response.status).toBe(422);
		expect(response.body.error).toBe("ValidationError");
		expect(response.body.details.length).toBeGreaterThan(0);
	});

	it("serves map-defined models too", async () => {
		const response = await request(app).get("/api/Region?regionID=1");

		expect(response.status).toBe(200);
		expect(response.body.total).toBe(1);
		expect(response.body.items[0].name).toBeDefined();
	});

	it("404s unknown models as JSON", async () => {
		const response = await request(app).get("/api/NotAModel");

		expect(response.status).toBe(404);
		expect(response.body.error).toBe("NotFound");
	});
});
