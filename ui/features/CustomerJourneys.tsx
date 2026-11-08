import { Fragment, useCallback, useEffect, useState } from "react";

/**
NTS-539 — Customer journeys view: "customers who started with X went on
to buy Y", ranked by how many customers made each transition. Insight
views follow BasketTwins' shape; this one fetches directly (no query
param to pick), so 401s surface as errors.
*/
interface Transition {
	fromProductID: number;
	fromName: string;
	toProductID: number;
	toName: string;
	customers: number;
}

interface Journey {
	customerID: string;
	company: string;
	country: string;
	firstOrderID: number;
	firstDate: string;
	secondOrderID: number;
	secondDate: string;
}

export function CustomerJourneys() {
	const [transitions, setTransitions] = useState<Transition[]>();
	const [expanded, setExpanded] = useState<string | undefined>(undefined);
	const [journeys, setJourneys] = useState<Journey[]>([]);
	const [error, setError] = useState("");

	const expand = (transition: Transition): void => {
		const key = `${transition.fromProductID}-${transition.toProductID}`;

		if (expanded === key) {
			setExpanded(undefined);
			return;
		}

		setExpanded(key);
		setJourneys([]);

		void fetch(
			`/api/insight/journeys/${transition.fromProductID}/${transition.toProductID}`,
		)
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`${response.status} ${await response.text()}`);
				}
				return response.json() as Promise<{ journeys: Journey[] }>;
			})
			.then((result) => setJourneys(result.journeys))
			.catch((problem: Error) => setError(problem.message));
	};

	const load = useCallback((): void => {
		void fetch("/api/insight/journeys")
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`${response.status} ${await response.text()}`);
				}
				return response.json() as Promise<{ transitions: Transition[] }>;
			})
			.then((result) => {
				setTransitions(result.transitions);
				setError("");
			})
			.catch((problem: Error) => setError(problem.message));
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const max = transitions
		? Math.max(...transitions.map((t) => t.customers), 1)
		: 1;

	return (
		<div>
			<h1>Customer journeys — what customers buy next</h1>
			<div className="panel">
				<button className="primary" onClick={load}>
					refresh
				</button>
				{error !== "" && <div className="error">{error}</div>}
			</div>

			{transitions !== undefined && (
				<table>
					<thead>
						<tr>
							<th>started with</th>
							<th>then bought</th>
							<th>customers</th>
						</tr>
					</thead>
					<tbody>
						{transitions.map((transition) => {
							const key = `${transition.fromProductID}-${transition.toProductID}`;
							const isOpen = expanded === key;

							return (
								<Fragment key={key}>
									<tr
										style={{ cursor: "pointer" }}
										onClick={() => {
											expand(transition);
										}}
									>
										<td>
											{isOpen ? "▾" : "▸"} {transition.fromName}
										</td>
										<td>{transition.toName}</td>
										<td style={{ minWidth: 220 }}>
											<div
												className="bar"
												style={{
													width: `${Math.round((100 * transition.customers) / max)}%`,
												}}
											/>
											<span className="muted"> {transition.customers}</span>
										</td>
									</tr>
									{isOpen && (
										<tr>
											<td colSpan={3}>
												{journeys.length === 0 ? (
													<span className="muted">loading the journeys…</span>
												) : (
													<table>
														<thead>
															<tr>
																<th>customer</th>
																<th>country</th>
																<th>first order</th>
																<th>then</th>
															</tr>
														</thead>
														<tbody>
															{journeys.map((journey) => (
																<tr key={journey.customerID}>
																	<td>
																		{journey.company}{" "}
																		<span className="muted">
																			({journey.customerID})
																		</span>
																	</td>
																	<td className="muted">{journey.country}</td>
																	<td>
																		<a
																			onClick={() => {
																				window.location.hash = `#/entity/Order/${journey.firstOrderID}`;
																			}}
																		>
																			#{journey.firstOrderID}
																		</a>{" "}
																		<span className="muted">
																			{journey.firstDate.slice(0, 10)}
																		</span>
																	</td>
																	<td>
																		<a
																			onClick={() => {
																				window.location.hash = `#/entity/Order/${journey.secondOrderID}`;
																			}}
																		>
																			#{journey.secondOrderID}
																		</a>{" "}
																		<span className="muted">
																			{journey.secondDate.slice(0, 10)}
																		</span>
																	</td>
																</tr>
															))}
														</tbody>
													</table>
												)}
											</td>
										</tr>
									)}
								</Fragment>
							);
						})}
					</tbody>
				</table>
			)}
		</div>
	);
}
