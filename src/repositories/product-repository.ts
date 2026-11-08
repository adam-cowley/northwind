import { EntityRepository, toFulltextQuery, Repository } from "neode";
import { Product } from "../models/product.js";

/**
Catalog + stock operations. INeode-scope only (tx-safe).
*/
@EntityRepository(Product)
class ProductRepository extends Repository<Product> {
	/**
  One catalog page over the projection-aware read: every row already
  carries its supplier DTO, category, counts and read-model fields from
  the single query findAll() ran (NTS-501 fix).
  */
	async catalog(page = 1, limit = 12, filter: Partial<Product> = {}) {
		const [items, total] = await Promise.all([
			this.findAll(filter, {
				order: { productID: "ASC" },
				skip: (page - 1) * limit,
				limit,
			}),
			this.count(filter),
		]);

		return {
			items,
			total,
			page,
			limit,
			totalPages: Math.max(1, Math.ceil(total / limit)),
		};
	}

	/** Full-text over the model's declared fulltext properties, Lucene-escaped. */
	async searchProducts(text: string, limit = 10) {
		return this.search(toFulltextQuery(text), { limit });
	}

	/**
  Soft discontinuation: the flag, not a delete — order history must keep
  resolving. Dirty tracking (NTS-157) means save() writes only this field.
  */
	async discontinue(product: Product): Promise<Product> {
		product.discontinued = true;

		return this.save(product);
	}

	/** Atomic stock bump — one server-side statement, concurrency-safe. */
	async restock(product: Product, by: number): Promise<number> {
		return this.increment(product, "unitsInStock", by);
	}
}

export { ProductRepository };
