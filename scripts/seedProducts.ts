import mongoose from "mongoose";
import { Product } from "../src/models/Product.js";
import { Inventory } from "../src/models/Inventory.js";
import "dotenv/config";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/order-system";

const seedProducts = async () => {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });
    console.log("Connected to MongoDB");

    // Clear existing (optional) - you can comment this out if you want to keep existing products
    // await Product.deleteMany({});
    // await Inventory.deleteMany({});

    const products = [];
    const categories = [
      "Apparel",
      "Footwear",
      "Accessories",
      "Electronics",
      "Home Decor",
    ];
    const materials = ["Cotton", "Leather", "Metal", "Plastic", "Wood"];

    for (let i = 1; i <= 20; i++) {
      const category = categories[i % categories.length];
      const name = `Premium ${category} Item ${i}`;
      const hasVariants = i % 2 === 0;

      const product = new Product({
        name: name,
        sku: `PRD-${Date.now()}-${i}`,
        slug: `premium-item-${Date.now()}-${i}`,
        shortDescription: `A high-quality ${category.toLowerCase()} item for everyday use.`,
        description: `This is the full description for ${name}. It is made from premium materials and designed to last. Perfect for those who appreciate quality and style.`,
        price: Math.floor(Math.random() * 200) + 20,
        compareAtPrice: Math.floor(Math.random() * 250) + 50,
        costPrice: Math.floor(Math.random() * 100) + 10,
        category: category,
        brand: "Atomic Order",
        tags: ["premium", "new arrival", category.toLowerCase()],
        productType: "physical",
        images: [
          {
            url: `https://images.unsplash.com/photo-${
              1500000000000 + i
            }?auto=format&fit=crop&q=80&w=800`,
            altText: `${name} main image`,
            sortOrder: 0,
            isPrimary: true,
          },
        ],
        hasVariants: hasVariants,
        variants: hasVariants
          ? [
              {
                sku: `PRD-${Date.now()}-${i}-S`,
                variantOptions: [{ name: "Size", value: "S" }],
                price: Math.floor(Math.random() * 200) + 20,
                isActive: true,
              },
              {
                sku: `PRD-${Date.now()}-${i}-M`,
                variantOptions: [{ name: "Size", value: "M" }],
                price: Math.floor(Math.random() * 200) + 20,
                isActive: true,
              },
            ]
          : [],
        variantOptionNames: hasVariants ? ["Size"] : [],
        weight: Math.floor(Math.random() * 10) + 1,
        weightUnit: "kg",
        material: materials[i % materials.length],
        isFeatured: i <= 5, // make first 5 featured
        avgRating: Number((Math.random() * (5 - 3.5) + 3.5).toFixed(1)),
        reviewCount: Math.floor(Math.random() * 100),
        minOrderQty: 1,
        isActive: true,
      });

      products.push(product);
    }

    const insertedProducts = await Product.insertMany(products);
    console.log(
      `Successfully added ${insertedProducts.length} products to the database.`
    );

    // Create corresponding inventory records
    const inventoryRecords = [];
    for (const prod of insertedProducts) {
      if (prod.hasVariants) {
        for (const variant of prod.variants) {
          inventoryRecords.push({
            productId: prod._id,
            variantId: variant._id, // Add variant ID if present
            sku: variant.sku,
            quantity: Math.floor(Math.random() * 50) + 10,
            lowStockThreshold: 5,
            restockDate: null,
            status: "in_stock",
            reservations: [],
            location: "Main Warehouse",
          });
        }
      } else {
        inventoryRecords.push({
          productId: prod._id,
          sku: prod.sku,
          quantity: Math.floor(Math.random() * 100) + 20,
          lowStockThreshold: 10,
          status: "in_stock",
          location: "Main Warehouse",
        });
      }
    }

    await Inventory.insertMany(inventoryRecords);
    console.log(
      `Successfully added ${inventoryRecords.length} inventory records.`
    );
  } catch (error) {
    console.error("Error seeding products:", error);
  } finally {
    await mongoose.connection.close();
    console.log("MongoDB connection closed.");
  }
};

seedProducts();
