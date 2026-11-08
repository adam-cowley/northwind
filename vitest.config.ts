import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "unit",
					include: ["test/unit/**/*.test.ts"],
					globals: true,
				},
			},
			{
				test: {
					name: "integration",
					include: ["test/integration/**/*.test.ts"],
					testTimeout: 120000,
					fileParallelism: false,
					globals: true,
					env: {
						RELATE_LIB:
							"/Users/adam/neode/relate/target/release/librelate_ffi.dylib",
						RELATE_CLIENT_PATH: "/Users/adam/neode/relate/clients/javascript",
					},
				},
			},
		],
	},
});
