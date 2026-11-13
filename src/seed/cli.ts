import { fromEnv, waitUntilReachable } from "neode";
import { loadConfig, authFromEnv } from "../config.js";
import { graphCounts, seed } from "./seed.js";

/**
Seed CLI: `node dist/seed/cli.js [--fresh] [--orders N]`
*/
async function main(): Promise<void> {
	const fresh = process.argv.includes("--fresh");
	const ordersIndex = process.argv.indexOf("--orders");
	const syntheticOrders =
		ordersIndex >= 0 ? Number(process.argv[ordersIndex + 1]) : 0;

	const config = loadConfig();

	// Ops demo: wait for the database with exponential-ish backoff (fresh
	// containers boot slow), using the library's connectivity helpers
	const auth = authFromEnv();

	await waitUntilReachable(
		{
			uri: config.connectivity.uri,
			...(auth === undefined ? {} : { auth }),
			...(config.connectivity.database === undefined
				? {}
				: { database: config.connectivity.database }),
		},
		{ timeout: 60000 },
	);
	console.log("database reachable");

	const neode = fromEnv();

	if (fresh) {
		const { wipe } = await import("neode");
		// --fresh is the operator's explicit confirmation (NTS-578 guard)
		await wipe(neode, { confirm: true });
		console.log("graph wiped");
	}

	const stats = await seed(neode, { syntheticOrders });

	console.log("seeded:", JSON.stringify(stats));
	console.log("graph counts:", JSON.stringify(await graphCounts(neode)));

	await neode.close();
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
