import { useEffect, useState } from "react";

/**
NTS-536 — Data quality view: a checklist of negative graph-pattern
checks. 0 hits = green pass badge, hits = amber count with an
expandable example list. Direct fetch — same-origin cookies flow
automatically, 401s redirect to /login.
*/
interface Check {
	id: string;
	label: string;
	count: number;
	examples: string[];
}

async function get<T>(path: string): Promise<T> {
	const response = await fetch(path);

	if (response.status === 401) {
		window.location.href = "/login";
		throw new Error("unauthorized");
	}

	if (!response.ok) {
		throw new Error(`${response.status} ${await response.text()}`);
	}

	return response.json() as Promise<T>;
}

export function DataQuality() {
	const [checks, setChecks] = useState<Check[]>();
	const [error, setError] = useState("");
	const [open, setOpen] = useState("");

	useEffect(() => {
		void get<{ checks: Check[] }>("/api/insight/quality")
			.then((result) => setChecks(result.checks))
			.catch((problem: Error) => setError(problem.message));
	}, []);

	return (
		<div>
			<h1>Data quality — orphan and hygiene checks</h1>
			{error !== "" && <div className="error">{error}</div>}

			{checks === undefined ? (
				<div className="muted">running checks…</div>
			) : (
				<div className="panel">
					{checks.map((check) => {
						const clean = check.count === 0;

						return (
							<div
								key={check.id}
								style={{ padding: "6px 0", cursor: "pointer" }}
								onClick={() => setOpen(open === check.id ? "" : check.id)}
							>
								<span
									className={`badge ${clean ? "ok" : "best"}`}
									style={{ marginRight: 8 }}
								>
									{clean ? "✓ pass" : check.count}
								</span>
								{check.label}
								{open === check.id && check.examples.length > 0 && (
									<div className="muted" style={{ paddingLeft: 24 }}>
										{check.examples.join(", ")}
										{check.count > check.examples.length
											? ` … and ${check.count - check.examples.length} more`
											: ""}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
