/**
 * Synthetic Product Fixtures for Firebase Emulator Integration Tests
 * Completely isolated from any production customer or catalog data.
 */

export interface TestProduct {
    id: string;
    name: string;
    slug: string;
    price: number;
    inventory: number;
    isVisible: boolean;
    isCustomized: boolean;
    category: string;
    images: string[];
    createdAt: number;
}

export const SYNTHETIC_PRODUCTS: Record<string, TestProduct> = {
    "prod-hoodie-1000": {
        id: "prod-hoodie-1000",
        name: "Synthetic Demo Hoodie",
        slug: "synthetic-demo-hoodie",
        price: 1000,
        inventory: 10,
        isVisible: true,
        isCustomized: false,
        category: "apparel",
        images: ["https://example.com/demo-hoodie.jpg"],
        createdAt: Date.now(),
    },
    "prod-tshirt-500": {
        id: "prod-tshirt-500",
        name: "Synthetic Demo T-Shirt",
        slug: "synthetic-demo-tshirt",
        price: 500,
        inventory: 5,
        isVisible: true,
        isCustomized: false,
        category: "apparel",
        images: ["https://example.com/demo-tshirt.jpg"],
        createdAt: Date.now(),
    },
    "prod-scarce-stock-1": {
        id: "prod-scarce-stock-1",
        name: "Scarce Stock Limited Cap",
        slug: "scarce-stock-cap",
        price: 750,
        inventory: 1, // Exactly 1 unit in stock for concurrency testing
        isVisible: true,
        isCustomized: false,
        category: "accessories",
        images: ["https://example.com/demo-cap.jpg"],
        createdAt: Date.now(),
    },
    "prod-sold-out-0": {
        id: "prod-sold-out-0",
        name: "Sold Out Demo Mug",
        slug: "sold-out-demo-mug",
        price: 250,
        inventory: 0, // Out of stock
        isVisible: true,
        isCustomized: false,
        category: "accessories",
        images: ["https://example.com/demo-mug.jpg"],
        createdAt: Date.now(),
    },
    "prod-hidden-draft": {
        id: "prod-hidden-draft",
        name: "Unpublished Draft Jacket",
        slug: "unpublished-draft-jacket",
        price: 2000,
        inventory: 10,
        isVisible: false, // Inactive in catalog
        isCustomized: false,
        category: "apparel",
        images: ["https://example.com/demo-jacket.jpg"],
        createdAt: Date.now(),
    },
};
