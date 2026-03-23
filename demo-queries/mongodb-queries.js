// ============================================================
// MongoDB Demo Queries — from basic to advanced
// Database: demodb | Container: mongodb-demo | Port: 27017
// Connection: mongosh -u root -p rootpass --authenticationDatabase admin demodb
// ============================================================

// ────────────────────────────────────────────────
// 1. BASIC QUERIES
// ────────────────────────────────────────────────

// All employees in Engineering
db.employees.find(
  { department_id: 1 },
  { first_name: 1, last_name: 1, job_title: 1, email: 1 }
).sort({ last_name: 1 });

// Products over $500
db.products.find(
  { price: { $gt: 500 }, status: "active" },
  { name: 1, sku: 1, price: 1, cost: 1 }
).sort({ price: -1 });

// Customers by tier with count
db.customers.aggregate([
  { $group: {
    _id: "$loyalty_tier",
    count: { $sum: 1 },
    avg_spent: { $avg: "$total_spent" }
  }},
  { $sort: { avg_spent: -1 } }
]);

// ────────────────────────────────────────────────
// 2. AGGREGATION PIPELINE — JOINS & GROUPING
// ────────────────────────────────────────────────

// Employee directory with department lookup
db.employees.aggregate([
  { $lookup: {
    from: "departments",
    localField: "department_id",
    foreignField: "_id",
    as: "dept"
  }},
  { $unwind: "$dept" },
  { $lookup: {
    from: "employees",
    localField: "manager_id",
    foreignField: "_id",
    as: "mgr"
  }},
  { $unwind: { path: "$mgr", preserveNullAndEmptyArrays: true } },
  { $project: {
    full_name: { $concat: ["$first_name", " ", "$last_name"] },
    email: 1,
    job_title: 1,
    department: "$dept.name",
    manager: { $cond: [
      { $ifNull: ["$mgr", false] },
      { $concat: ["$mgr.first_name", " ", "$mgr.last_name"] },
      "None"
    ]},
    hire_date: 1
  }},
  { $sort: { department: 1, full_name: 1 } }
]);

// Full order details with customer info and product names
db.orders.aggregate([
  { $lookup: {
    from: "customers",
    localField: "customer_id",
    foreignField: "_id",
    as: "customer"
  }},
  { $unwind: "$customer" },
  { $addFields: {
    customer_name: { $concat: ["$customer.first_name", " ", "$customer.last_name"] },
    item_count: { $size: "$items" },
    total_quantity: { $sum: "$items.quantity" }
  }},
  { $project: {
    order_number: 1,
    order_date: 1,
    status: 1,
    customer_name: 1,
    "customer.loyalty_tier": 1,
    item_count: 1,
    total_quantity: 1,
    total: 1,
    "payment.method": 1,
    "shipping.carrier": 1
  }},
  { $sort: { order_date: -1 } }
]);

// Revenue by product category
db.orders.aggregate([
  { $match: { status: { $nin: ["cancelled", "refunded"] } } },
  { $unwind: "$items" },
  { $lookup: {
    from: "products",
    localField: "items.product_id",
    foreignField: "_id",
    as: "product"
  }},
  { $unwind: "$product" },
  { $lookup: {
    from: "categories",
    localField: "product.category_id",
    foreignField: "_id",
    as: "category"
  }},
  { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
  { $group: {
    _id: { $ifNull: ["$category.name", "Uncategorized"] },
    total_revenue: { $sum: { $multiply: ["$items.quantity", "$items.unit_price"] } },
    units_sold: { $sum: "$items.quantity" },
    order_count: { $addToSet: "$_id" }
  }},
  { $addFields: { order_count: { $size: "$order_count" } } },
  { $sort: { total_revenue: -1 } }
]);

// ────────────────────────────────────────────────
// 3. ADVANCED AGGREGATION
// ────────────────────────────────────────────────

// Monthly revenue with running calculations
db.orders.aggregate([
  { $match: { status: { $nin: ["cancelled", "refunded"] } } },
  { $group: {
    _id: {
      year: { $year: "$order_date" },
      month: { $month: "$order_date" }
    },
    revenue: { $sum: "$total" },
    order_count: { $sum: 1 },
    unique_customers: { $addToSet: "$customer_id" },
    avg_order: { $avg: "$total" }
  }},
  { $addFields: {
    unique_customers: { $size: "$unique_customers" },
    month_str: {
      $concat: [
        { $toString: "$_id.year" }, "-",
        { $cond: [{ $lt: ["$_id.month", 10] }, { $concat: ["0", { $toString: "$_id.month" }] }, { $toString: "$_id.month" }] }
      ]
    }
  }},
  { $sort: { "_id.year": 1, "_id.month": 1 } },
  { $setWindowFields: {
    sortBy: { "_id.year": 1, "_id.month": 1 },
    output: {
      cumulative_revenue: {
        $sum: "$revenue",
        window: { documents: ["unbounded", "current"] }
      },
      prev_month_revenue: {
        $shift: { output: "$revenue", by: -1 }
      },
      moving_avg_3m: {
        $avg: "$revenue",
        window: { documents: [-2, "current"] }
      }
    }
  }},
  { $addFields: {
    growth_pct: {
      $cond: [
        { $and: [{ $ne: ["$prev_month_revenue", null] }, { $ne: ["$prev_month_revenue", 0] }] },
        { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$revenue", "$prev_month_revenue"] }, "$prev_month_revenue"] }, 100] }, 1] },
        null
      ]
    }
  }},
  { $project: {
    _id: 0, month: "$month_str", revenue: { $round: ["$revenue", 2] },
    order_count: 1, unique_customers: 1,
    avg_order: { $round: ["$avg_order", 2] },
    cumulative_revenue: { $round: ["$cumulative_revenue", 2] },
    growth_pct: 1,
    moving_avg_3m: { $round: ["$moving_avg_3m", 2] }
  }}
]);

// RFM Analysis
db.orders.aggregate([
  { $match: { status: { $nin: ["cancelled", "refunded"] } } },
  { $group: {
    _id: "$customer_id",
    last_order: { $max: "$order_date" },
    frequency: { $sum: 1 },
    monetary: { $sum: "$total" }
  }},
  { $addFields: {
    recency_days: {
      $dateDiff: { startDate: "$last_order", endDate: new Date(), unit: "day" }
    }
  }},
  { $lookup: {
    from: "customers",
    localField: "_id",
    foreignField: "_id",
    as: "cust"
  }},
  { $unwind: "$cust" },
  { $setWindowFields: {
    sortBy: { recency_days: 1 },
    output: {
      r_score: { $denseRank: {} }
    }
  }},
  { $setWindowFields: {
    sortBy: { frequency: -1 },
    output: {
      f_score: { $denseRank: {} }
    }
  }},
  { $setWindowFields: {
    sortBy: { monetary: -1 },
    output: {
      m_score: { $denseRank: {} }
    }
  }},
  { $addFields: {
    customer: { $concat: ["$cust.first_name", " ", "$cust.last_name"] },
    segment: {
      $switch: {
        branches: [
          { case: { $and: [{ $gte: ["$r_score", 4] }, { $gte: ["$f_score", 4] }] }, then: "Champions" },
          { case: { $and: [{ $gte: ["$r_score", 3] }, { $gte: ["$f_score", 3] }] }, then: "Loyal" },
          { case: { $and: [{ $gte: ["$r_score", 4] }, { $lte: ["$f_score", 2] }] }, then: "New" },
          { case: { $and: [{ $lte: ["$r_score", 2] }, { $gte: ["$f_score", 3] }] }, then: "At Risk" }
        ],
        default: "Other"
      }
    }
  }},
  { $project: {
    _id: 0, customer: 1, recency_days: 1, frequency: 1,
    monetary: { $round: ["$monetary", 2] },
    r_score: 1, f_score: 1, m_score: 1, segment: 1
  }},
  { $sort: { monetary: -1 } }
]);

// Market basket analysis
db.orders.aggregate([
  { $match: { status: { $nin: ["cancelled", "refunded"] }, "items.1": { $exists: true } } },
  { $addFields: {
    product_pairs: {
      $reduce: {
        input: { $range: [0, { $subtract: [{ $size: "$items" }, 1] }] },
        initialValue: [],
        in: {
          $concatArrays: [
            "$$value",
            { $map: {
              input: { $range: [{ $add: ["$$this", 1] }, { $size: "$items" }] },
              as: "j",
              in: {
                a: { $arrayElemAt: ["$items.product_id", "$$this"] },
                b: { $arrayElemAt: ["$items.product_id", "$$j"] }
              }
            }}
          ]
        }
      }
    }
  }},
  { $unwind: "$product_pairs" },
  { $group: {
    _id: {
      a: { $min: ["$product_pairs.a", "$product_pairs.b"] },
      b: { $max: ["$product_pairs.a", "$product_pairs.b"] }
    },
    count: { $sum: 1 }
  }},
  { $lookup: { from: "products", localField: "_id.a", foreignField: "_id", as: "prod_a" } },
  { $lookup: { from: "products", localField: "_id.b", foreignField: "_id", as: "prod_b" } },
  { $project: {
    _id: 0,
    product_a: { $arrayElemAt: ["$prod_a.name", 0] },
    product_b: { $arrayElemAt: ["$prod_b.name", 0] },
    co_purchases: "$count"
  }},
  { $sort: { co_purchases: -1 } }
]);

// ────────────────────────────────────────────────
// 4. MONGODB-SPECIFIC FEATURES
// ────────────────────────────────────────────────

// Full-text search (uses text index)
db.products.find(
  { $text: { $search: "wireless keyboard" } },
  { score: { $meta: "textScore" }, name: 1, price: 1, description: 1 }
).sort({ score: { $meta: "textScore" } });

// Faceted search: multi-dimensional aggregation
db.products.aggregate([
  { $facet: {
    "by_price_range": [
      { $bucket: {
        groupBy: "$price",
        boundaries: [0, 100, 500, 1000, 2000, 5000],
        default: "5000+",
        output: { count: { $sum: 1 }, products: { $push: "$name" } }
      }}
    ],
    "by_status": [
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ],
    "stats": [
      { $group: {
        _id: null,
        avg_price: { $avg: "$price" },
        min_price: { $min: "$price" },
        max_price: { $max: "$price" },
        total: { $sum: 1 }
      }}
    ]
  }}
]);

// Graph lookup: find all reports (transitive managers)
db.employees.aggregate([
  { $match: { manager_id: null } },
  { $graphLookup: {
    from: "employees",
    startWith: "$_id",
    connectFromField: "_id",
    connectToField: "manager_id",
    as: "all_reports",
    maxDepth: 5,
    depthField: "level"
  }},
  { $project: {
    manager: { $concat: ["$first_name", " ", "$last_name"] },
    direct_reports: {
      $size: { $filter: { input: "$all_reports", cond: { $eq: ["$$this.level", 0] } } }
    },
    total_reports: { $size: "$all_reports" },
    report_chain: {
      $map: {
        input: { $sortArray: { input: "$all_reports", sortBy: { level: 1 } } },
        as: "r",
        in: {
          name: { $concat: ["$$r.first_name", " ", "$$r.last_name"] },
          title: "$$r.job_title",
          depth: "$$r.level"
        }
      }
    }
  }}
]);

// Nested array operations: customers with address analysis
db.customers.aggregate([
  { $addFields: {
    full_name: { $concat: ["$first_name", " ", "$last_name"] },
    address_count: { $size: { $ifNull: ["$addresses", []] } },
    countries: { $setUnion: { $ifNull: [{ $map: { input: "$addresses", as: "a", in: "$$a.country" } }, []] } },
    has_default: {
      $gt: [
        { $size: { $filter: { input: { $ifNull: ["$addresses", []] }, cond: { $eq: ["$$this.is_default", true] } } } },
        0
      ]
    }
  }},
  { $project: {
    full_name: 1, loyalty_tier: 1, total_spent: 1,
    address_count: 1, countries: 1, has_default: 1
  }},
  { $sort: { total_spent: -1 } }
]);

// ────────────────────────────────────────────────
// 5. VIEWS
// ────────────────────────────────────────────────

db.v_employee_directory.find().sort({ department: 1 });
db.v_product_catalog.find({}, { name: 1, price: 1, margin_pct: 1, total_stock: 1 }).sort({ margin_pct: -1 });
db.v_order_summary.find().sort({ order_date: -1 });
db.v_monthly_revenue.find().sort({ month: 1 });
db.v_inventory_alerts.find({ stock_status: { $in: ["CRITICAL", "LOW", "OUT_OF_STOCK"] } });

// ────────────────────────────────────────────────
// 6. INDEXES & EXPLAIN
// ────────────────────────────────────────────────

// List all indexes
db.getCollectionNames().forEach(c => {
  const idxs = db[c].getIndexes();
  if (idxs.length > 1) print(`\n${c}: ${idxs.length} indexes`);
  idxs.forEach(i => { if (i.name !== '_id_') printjson(i); });
});

// Explain a query to see index usage
db.orders.find({ customer_id: 1, status: "delivered" }).explain("executionStats");

// Verify text index works
db.products.find({ $text: { $search: "laptop" } }).explain("executionStats");

// ────────────────────────────────────────────────
// 7. COLLECTION STATS
// ────────────────────────────────────────────────

db.getCollectionNames().filter(n => !n.startsWith('system.')).forEach(name => {
  const stats = db[name].estimatedDocumentCount();
  print(`${name}: ${stats} documents`);
});
