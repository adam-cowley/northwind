import type Neode from "neode";
import type { Hono } from "hono";
import { createBasketTwinsRoutes } from "./basket-twins.js";
import { createCategoryAffinityRoutes } from "./category-affinity.js";
import { createCountryRoutes } from "./country-drilldown.js";
import { createCustomerJourneysRoutes } from "./customer-journeys.js";
import { createDataQualityRoutes } from "./data-quality.js";
import { createEntityDetailRoutes } from "./entity-detail.js";
import { createGrowthBoardRoutes } from "./growth-board.js";
import { createProductLinksRoutes } from "./product-links.js";
import { createRegionRollupRoutes } from "./region-rollup.js";
import { createReorderNetworkRoutes } from "./reorder-network.js";
import { createShipperCoverageRoutes } from "./shipper-coverage.js";
import { createSupplyExposureRoutes } from "./supply-exposure.js";

/**
The feature registry (NTS-556): every insight/entity sub-app with its
mount path, in mount order. Adding feature #13 = one file with
`create<Feature>Routes(neode: Neode): Hono` (basket-twins.ts's shape)
plus one line here — app.ts mounts the lot unchanged.
*/
export const features: {
	mount: string;
	routes: (neode: Neode) => Hono;
}[] = [
	{ mount: "/api/insight", routes: createBasketTwinsRoutes },
	{ mount: "/api/insight", routes: createCategoryAffinityRoutes },
	{ mount: "/api/insight", routes: createGrowthBoardRoutes },
	{ mount: "/api/insight", routes: createShipperCoverageRoutes },
	{ mount: "/api/insight", routes: createReorderNetworkRoutes },
	{ mount: "/api/insight", routes: createSupplyExposureRoutes },
	{ mount: "/api/insight", routes: createCustomerJourneysRoutes },
	{ mount: "/api/insight", routes: createProductLinksRoutes },
	{ mount: "/api/insight", routes: createDataQualityRoutes },
	{ mount: "/api/insight", routes: createRegionRollupRoutes },
	{ mount: "/api/entity", routes: createEntityDetailRoutes },
	{ mount: "/api/insight", routes: createCountryRoutes },
];
