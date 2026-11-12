import express, { type Express } from "express";
import { router } from "neode/express";
import type { Neode } from "neode";

// Importing registers every model — the router enumerates the registry
import "../models/index.js";

/**
The generated REST API over the same Northwind models — every registered
node model gets list / get / create / update / delete straight from its
definition (NTS-664). The domain operations the dashboard consumes live
in the Hono app (../api/app.ts); this mounts what the definitions alone
can answer.
*/
export function createExpressApp(neode: Neode): Express {
	const app = express();

	app.use(express.json());
	app.use("/api", router(neode));

	return app;
}
