import {
	instrumentConnectionProvider,
	verifyConnectivity,
	RelateConnectionProvider,
	requireRelateClient,
	fromEnv,
} from "neode";
import Neode from "neode";
import { loadConfig } from "./config.js";

/**
Shared connection setup for both servers (Hono + Express). A real server
via NEO4J_* env (the library's fromEnv), or the embedded Relate engine
in-memory when none is configured — the zero-setup demo, with the
instrumented provider showing the driver-level tap.
*/
export async function connect(): Promise<Neode> {
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
