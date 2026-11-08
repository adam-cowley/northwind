import { useEffect, useState } from "react";
import { goToEntity, goToPage } from "../nav.js";

/**
The generic entity view: properties + the 1-hop typed neighborhood, with
every neighbor id clickable (IdLink pattern all the way down).
*/
interface EntityView {
	type: string;
	id: unknown;
	display: string;
	properties: Record<string, unknown>;
	edges: {
		relType: string;
		direction: "out" | "in";
		neighborType?: string;
		neighborId?: unknown;
		neighborDisplay: string;
	}[];
}

const HIDDEN_PROPERTIES = new Set(["embedding", "elementId"]);

export function EntityDetail({ type, id }: { type: string; id: string }) {
	const [entity, setEntity] = useState<EntityView>();
	const [error, setError] = useState("");

	useEffect(() => {
		setEntity(undefined);

		void fetch(`/api/entity/${type}/${id}`)
			.then(async (response) => {
				if (response.status === 404) {
					throw new Error(`No ${type} ${id} in the graph`);
				}

				if (response.status === 401) {
					window.location.href = "/login";
					throw new Error("unauthorized");
				}

				if (!response.ok) {
					throw new Error(`${response.status} ${await response.text()}`);
				}

				return response.json() as Promise<EntityView>;
			})
			.then(setEntity)
			.catch((problem: Error) => setError(problem.message));
	}, [type, id]);

	if (error !== "") {
		return (
			<div>
				<a onClick={() => goToPage("Dashboard")}>← dashboard</a>
				<div className="error">{error}</div>
			</div>
		);
	}

	if (entity === undefined) {
		return (
			<div>
				<a onClick={() => goToPage("Dashboard")}>← dashboard</a>
				<div className="muted">loading…</div>
			</div>
		);
	}

	const propertyRows = Object.entries(entity.properties).filter(
		([key, value]) =>
			!HIDDEN_PROPERTIES.has(key) && value !== null && value !== undefined,
	);

	const grouped = new Map<string, EntityView["edges"]>();

	for (const edge of entity.edges) {
		const key = `${edge.direction === "out" ? "→" : "←"} ${edge.relType}`;

		const bucket = grouped.get(key) ?? [];

		bucket.push(edge);
		grouped.set(key, bucket);
	}

	return (
		<div>
			<a onClick={() => goToPage("Dashboard")}>← dashboard</a>

			<h1>
				{entity.display} <span className="muted">:{entity.type}</span>
			</h1>

			<div className="grid2">
				<div>
					<h2>Properties</h2>
					<table>
						<tbody>
							{propertyRows.map(([key, value]) => (
								<tr key={key}>
									<td className="muted">{key}</td>
									<td>
										{typeof value === "object"
											? JSON.stringify(value)
											: String(value)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<div>
					<h2>Connected ({entity.edges.length} edges)</h2>
					{[...grouped.entries()].map(([heading, edges]) => (
						<div className="panel" key={heading}>
							<strong>{heading}</strong>
							{edges.map((edge, index) => {
								const neighborType = edge.neighborType;
								const neighborId = edge.neighborId;

								return (
									<div className="entry" key={index}>
										{neighborType !== undefined &&
										neighborId !== undefined &&
										neighborId !== null ? (
											<a
												onClick={() => {
													goToEntity(neighborType, String(neighborId));
												}}
											>
												{edge.neighborDisplay}{" "}
												<span className="muted">({String(neighborId)})</span>
											</a>
										) : (
											<span>{edge.neighborDisplay}</span>
										)}
									</div>
								);
							})}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
