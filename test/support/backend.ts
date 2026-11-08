import { RelateConnectionProvider, requireRelateClient } from "neode";
import Neode from "neode";

/**
Test backend: one in-memory Relate engine per file (the same zero-setup
default the library's own suite uses), so files never see each other's
data and skip parallelism.
*/
export interface TestBackend {
	neode: Neode;
	clearGraph(): Promise<void>;
	close(): Promise<void>;
}

export async function openBackend(): Promise<TestBackend> {
	const client = requireRelateClient();
	const database = client.Database.open(":memory:");

	const neode = new Neode(new RelateConnectionProvider(database));

	return {
		neode,
		async clearGraph() {
			await neode.writeCypher("MATCH (n) DETACH DELETE n");
		},
		async close() {
			await neode.close();
		},
	};
}
