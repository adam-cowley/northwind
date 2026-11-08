import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import {
	instrumentConnectionProvider,
	verifyConnectivity,
	RelateConnectionProvider,
	requireRelateClient,
	fromEnv,
} from "neode";
import Neode from "neode";
import { loadConfig } from "./config.js";
import { createApp } from "./api/app.js";
import { NorthwindService } from "./services/northwind-service.js";
import { seed, graphCounts } from "./seed/seed.js";
import { CustomerRepository } from "./repositories/customer-repository.js";
import { OrderRepository } from "./repositories/order-repository.js";
import { ProductRepository } from "./repositories/product-repository.js";
import { Customer, Order, Product } from "./models/index.js";

/**
Northwind Ops server. Connection: a real server via NEO4J_* env (the
library's fromEnv), or the embedded Relate engine in-memory when none is
configured — the zero-setup demo, with the instrumented provider showing
the driver-level tap.
*/
async function connect(): Promise<Neode> {
	const config = loadConfig();

	if (process.env["NEO4J_URI"] || process.env["NEO4J_HOST"]) {
		const neode = fromEnv();

		await verifyConnectivity({
			uri: config.connectivity.uri,
			...(config.connectivity.database === undefined
				? {}
				: { database: config.connectivity.database }),
		});

		console.log(`connected to ${config.connectivity.uri}`);

		return neode;
	}

	const client = requireRelateClient();
	const database = client.Database.open(":memory:");

	console.log("no NEO4J_* env — using the embedded Relate engine (in-memory)");

	const instrumented = instrumentConnectionProvider(
		new RelateConnectionProvider(database),
		() => {
			// The provider-level tap; the API's inspector rides the QUERY_EXECUTED event
		},
	);

	return new Neode(instrumented);
}

async function main(): Promise<void> {
	const config = loadConfig();
	const neode = await connect();

	await neode.installSchema();
	console.log("schema installed");

	if (config.autoSeed) {
		const counts = await graphCounts(neode);

		if ((counts["Order"] ?? 0) === 0) {
			console.log("graph empty — seeding Northwind…");
			const stats = await seed(neode, {
				syntheticOrders: config.syntheticOrders,
			});
			console.log("seeded:", JSON.stringify(stats));
		}
	}

	console.log("graph:", JSON.stringify(await graphCounts(neode)));

	const service = new NorthwindService(
		neode,
		new ProductRepository(neode, Product),
		new OrderRepository(neode, Order),
		new CustomerRepository(neode, Customer),
	);

	const app = createApp(neode, service);

	// The built SPA (vite build → dist-ui), when present
	const uiRoot = new URL("../dist-ui", import.meta.url).pathname;

	if (existsSync(uiRoot)) {
		app.use("/*", serveStatic({ root: uiRoot }));
	}

	await new Promise<void>((resolve) => {
		serve({ fetch: app.fetch, port: config.port }, () => resolve());
	});

	console.log(`Northwind Ops → http://localhost:${config.port}`);

	process.on("SIGINT", () => {
		void neode.close().then(() => process.exit(0));
	});
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
