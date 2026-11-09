import { EntityRepository, NeodeError, Repository } from "neode";
import { Customer } from "../models/customer.js";

@EntityRepository(Customer)
class CustomerRepository extends Repository<Customer, typeof Customer> {
	/** The customer-360 read: the customer with their projected order count. */
	async profile(customerID: string): Promise<Customer> {
		const customer = await this.find(customerID);

		if (customer === undefined) {
			throw new NeodeError(`Customer ${customerID} does not exist`);
		}

		return customer;
	}
}

export { CustomerRepository };
