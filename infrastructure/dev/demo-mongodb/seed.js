const demoDb = db.getSiblingDB('arsenale_demo');

if (!demoDb.getUser('demo_mongo_user')) {
  demoDb.createUser({
    user: 'demo_mongo_user',
    pwd: 'DemoMongoPass123!',
    roles: [{ role: 'readWrite', db: 'arsenale_demo' }],
  });
}

demoDb.demo_customers.updateOne(
  { _id: 1 },
  {
    $set: {
      email: 'ada@example.dev',
      full_name: 'Ada Lovelace',
      region: 'emea',
      active: true,
      updated_at: new Date(),
    },
  },
  { upsert: true },
);

demoDb.demo_customers.updateOne(
  { _id: 2 },
  {
    $set: {
      email: 'grace@example.dev',
      full_name: 'Grace Hopper',
      region: 'na',
      active: true,
      updated_at: new Date(),
    },
  },
  { upsert: true },
);

demoDb.demo_orders.updateOne(
  { _id: 1001 },
  {
    $set: {
      customer_id: 1,
      order_total: 149.50,
      currency: 'EUR',
      status: 'paid',
      updated_at: new Date(),
    },
  },
  { upsert: true },
);

demoDb.demo_orders.updateOne(
  { _id: 1002 },
  {
    $set: {
      customer_id: 2,
      order_total: 219.00,
      currency: 'USD',
      status: 'pending',
      updated_at: new Date(),
    },
  },
  { upsert: true },
);

demoDb.demo_customers.createIndex({ email: 1 }, { unique: true });
demoDb.demo_orders.createIndex({ customer_id: 1 });
