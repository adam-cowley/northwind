import { RelateConnectionProvider, requireRelateClient } from "neode";
import Neode from "neode";
import { Customer } from "../../src/models/customer.ts";

const client = requireRelateClient();
const neode = new Neode(
	new RelateConnectionProvider(client.Database.open(":memory:")),
);

const row = {
	customerID: "TEST1",
	companyName: "Test Co",
	contactName: "A",
	contactTitle: "B",
	street: "S",
	city: "C",
	region: "",
	postalCode: "P",
	country: "UK",
	phone: "1",
};

// single create
const created = await neode.create(Customer, row);
console.log("single create ok:", created.customerID);

// bulk mergeMany with same shape
await neode.mergeMany(Customer, [{ ...row, customerID: "TEST2" }]);
console.log("bulk mergeMany ok");

// check what landed
const out = await neode.readCypher(
	"MATCH (c:Customer) RETURN c.customerID AS id, c.createdAt AS createdAt, c.updatedAt AS updatedAt",
	{},
);
for (const r of out.records)
	console.log(
		r.get("id"),
		"createdAt:",
		r.get("createdAt"),
		"updatedAt:",
		r.get("updatedAt"),
	);

await neode.close();
