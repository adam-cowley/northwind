import { useEffect, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import {
	Catalog,
	Console,
	Customers,
	Dashboard,
	Inventory,
	Ops,
	Orders,
	OrgChart,
	Suppliers,
} from "./pages";
import { BasketTwins } from "./features/BasketTwins.js";
import { CategoryAffinity } from "./features/CategoryAffinity.js";
import { GrowthBoard } from "./features/GrowthBoard.js";
import { ShipperCoverage } from "./features/ShipperCoverage.js";
import { ReorderNetwork } from "./features/ReorderNetwork.js";
import { SupplyExposure } from "./features/SupplyExposure.js";
import { CustomerJourneys } from "./features/CustomerJourneys.js";
import { ProductLinks } from "./features/ProductLinks.js";
import { DataQuality } from "./features/DataQuality.js";
import { RegionRollup } from "./features/RegionRollup.js";
import { CountryInsight } from "./features/CountryInsight.js";
import { EntityDetail } from "./features/EntityDetail.js";
import { parseHash, type Route } from "./nav.js";

/**
Pages: Catalog takes an optional product id (the drill-in), Customers an
optional customer id (the 360). Everything else is parameterless.
*/
const PAGES: { name: string; render: (entityId?: string) => ReactElement }[] = [
	{ name: "Dashboard", render: () => <Dashboard /> },
	{
		name: "Catalog",
		render: (entityId) => (
			<Catalog
				{...(entityId === undefined ? {} : { initialProduct: entityId })}
			/>
		),
	},
	{ name: "Orders", render: () => <Orders /> },
	{
		name: "Customers",
		render: (entityId) => (
			<Customers
				{...(entityId === undefined ? {} : { initialCustomer: entityId })}
			/>
		),
	},
	{ name: "Inventory", render: () => <Inventory /> },
	{ name: "Org", render: () => <OrgChart /> },
	{ name: "Suppliers", render: () => <Suppliers /> },
	{ name: "Console", render: () => <Console /> },
	{ name: "Ops", render: () => <Ops /> },
	{ name: "Twins", render: () => <BasketTwins /> },
	{ name: "Affinity", render: () => <CategoryAffinity /> },
	{ name: "Growth", render: () => <GrowthBoard /> },
	{ name: "Shippers", render: () => <ShipperCoverage /> },
	{ name: "Reorder", render: () => <ReorderNetwork /> },
	{ name: "Exposure", render: () => <SupplyExposure /> },
	{ name: "Journeys", render: () => <CustomerJourneys /> },
	{ name: "Links", render: () => <ProductLinks /> },
	{ name: "Quality", render: () => <DataQuality /> },
	{ name: "Regions", render: () => <RegionRollup /> },
	{ name: "Countries", render: () => <CountryInsight /> },
];

export function App() {
	const [route, setRoute] = useState<Route>(() =>
		parseHash(window.location.hash),
	);

	useEffect(() => {
		const onHashChange = (): void => {
			setRoute(parseHash(window.location.hash));
		};

		window.addEventListener("hashchange", onHashChange);

		return () => window.removeEventListener("hashchange", onHashChange);
	}, []);

	// Generic entity view: #/entity/Order/10856
	if (route.kind === "entity") {
		return (
			<div className="app">
				<nav>
					<div className="logo">🌬️ Northwind Ops</div>
					<NavList currentPage={undefined} />
				</nav>
				<main>
					<EntityDetail type={route.type} id={route.id} />
				</main>
			</div>
		);
	}

	const index = PAGES.findIndex((entry) => entry.name === route.page);
	const current = index === -1 ? 0 : index;
	const page = PAGES[current]!;

	return (
		<div className="app">
			<nav>
				<div className="logo">🌬️ Northwind Ops</div>
				<NavList currentPage={page.name} />
				<a
					style={{ marginTop: 24, color: "#f85149" }}
					onClick={() => {
						void fetch("/logout", { method: "POST" }).then(() => {
							window.location.href = "/login";
						});
					}}
				>
					sign out
				</a>
			</nav>
			<main>{page.render(route.entityId)}</main>
		</div>
	);
}

function NavList({ currentPage }: { currentPage: string | undefined }) {
	return (
		<>
			{PAGES.map((entry) => (
				<a
					key={entry.name}
					className={entry.name === currentPage ? "active" : ""}
					onClick={() => {
						window.location.hash = `#/${entry.name}`;
					}}
				>
					{entry.name}
				</a>
			))}
		</>
	);
}

createRoot(document.getElementById("root")!).render(<App />);
