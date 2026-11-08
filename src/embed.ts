/**
Deterministic, dependency-free embedding for the demo: 64-dim feature
hashing over the product text. Not semantic — same-ish words land near
each other only via token overlap — but stable, offline, and good enough
to demo `@Vector` + `knn()` ("similar products").
*/
const DIMENSIONS = 64;

function tokens(text: string): string[] {
	return text
		.toLowerCase()
		.replaceAll(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((token) => token.length > 1);
}

export function embed(text: string): number[] {
	const vector = new Array<number>(DIMENSIONS).fill(0);

	for (const token of tokens(text)) {
		let hash = 2166136261;
		for (let index = 0; index < token.length; index++) {
			hash ^= token.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}

		const slot = Math.abs(hash) % DIMENSIONS;
		// Signed hash in a second register spreads magnitude, so common
		// tokens point further along their direction
		vector[slot]! += (hash & 1) === 0 ? 1 : -1;
		vector[(slot * 7 + 13) % DIMENSIONS]! += token.length / 10;
	}

	const norm =
		Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;

	return vector.map((value) => value / norm);
}
