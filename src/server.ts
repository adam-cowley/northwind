import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { connect } from "./connect.js";
import { createApp } from "./api/app.js";
import { NorthwindService } from "./services/northwind-service.js";
import { seed, graphCounts } from "./seed/seed.js";
import { CustomerRepository } from "./repositories/customer-repository.js";
import { OrderRepository } from "./repositories/order-repository.js";
import { ProductRepository } from "./repositories/product-repository.js";
import { Customer, Order, Product } from "./models/index.js";

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
