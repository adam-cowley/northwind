import { connect } from "../connect.js";
import { graphCounts, seed } from "../seed/seed.js";
import { loadConfig } from "../config.js";
import { createExpressApp } from "./api.js";

/**
Express twin of the Northwind Ops server: same connection, same seed,
same models — but the API is the one generated from the definitions by
neode/express, not hand-written routes.
*/
async function main(): Promise<void> {
	const config = loadConfig();
	const neode = await connect();

	await neode.installSchema();
	console.log("schema installed");

	const counts = await graphCounts(neode);

	if ((counts["Order"] ?? 0) === 0) {
		console.log("graph empty — seeding Northwind…");
		const stats = await seed(neode, {
			syntheticOrders: config.syntheticOrders,
		});
		console.log("seeded:", JSON.stringify(stats));
	}

	console.log("graph:", JSON.stringify(await graphCounts(neode)));

	const port = Number(process.env["NW_EXPRESS_PORT"] ?? 3001);

	const app = createExpressApp(neode);

	const server = app.listen(port, () => {
		console.log(
			`Northwind generated API → http://localhost:${port}/api (GET /api for the ontology)`,
		);
	});

	process.on("SIGINT", () => {
		server.close(() => {
			void neode.close().then(() => process.exit(0));
		});
	});
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
