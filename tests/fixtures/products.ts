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
    customizationType?: "requires_name" | "requires_picture" | null;
    sizes?: string[];
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
    "prod-custom-frame-800": {
        id: "prod-custom-frame-800",
        name: "Synthetic Demo Custom Photo Frame",
        slug: "synthetic-demo-custom-photo-frame",
        price: 800,
        inventory: 15,
        isVisible: true,
        isCustomized: true,
        customizationType: "requires_picture",
        category: "accessories",
        images: ["https://example.com/demo-frame.jpg"],
        createdAt: Date.now(),
    },
    "prod-custom-mug-400": {
        id: "prod-custom-mug-400",
        name: "Synthetic Demo Personalized Mug",
        slug: "synthetic-demo-personalized-mug",
        price: 400,
        inventory: 20,
        isVisible: true,
        isCustomized: true,
        customizationType: "requires_name",
        category: "accessories",
        images: ["https://example.com/demo-mug-custom.jpg"],
        createdAt: Date.now(),
    },
    "prod-sized-shirt-600": {
        id: "prod-sized-shirt-600",
        name: "Synthetic Sized Regular T-Shirt",
        slug: "synthetic-sized-regular-tshirt",
        price: 600,
        inventory: 25,
        isVisible: true,
        isCustomized: false,
        sizes: ["S", "M", "L", "XL"],
        category: "apparel",
        images: ["https://example.com/demo-sized-shirt.jpg"],
        createdAt: Date.now(),
    },
};
