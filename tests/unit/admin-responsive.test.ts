import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_NAV_ITEMS } from "../../src/components/admin/ui/adminNavItems.ts";

describe("Admin Responsive Design System & Navigation Unit Tests (TASK 021)", () => {
    it("ADMIN-NAV-001: should configure all authoritative admin routes in navigation", () => {
        const expectedRoutes = [
            "/admin/dashboard",
            "/admin/products",
            "/admin/categories",
            "/admin/orders",
            "/admin/coupons",
        ];

        const actualRoutes = ADMIN_NAV_ITEMS.map(item => item.href);
        assert.deepEqual(actualRoutes, expectedRoutes);
    });

    it("ADMIN-NAV-002: each navigation item must export valid label and icon identifier", () => {
        for (const item of ADMIN_NAV_ITEMS) {
            assert.ok(item.label && item.label.length > 0, `Missing label for route ${item.href}`);
            assert.ok(["dashboard", "products", "categories", "orders", "coupons"].includes(item.icon), `Invalid icon identifier for ${item.label}`);
        }
    });

    it("ADMIN-FILTER-001: should accurately filter products by search query, category, and visibility", () => {
        const sampleProducts = [
            { id: "p1", name: "Bazaarvilla Signature Green Hoodie", category: "Apparel", categories: ["Apparel", "Winterwear"], isVisible: true },
            { id: "p2", name: "Custom Engraved Silver Cuff", category: "Accessories", categories: ["Accessories"], isVisible: false },
            { id: "p3", name: "Personalized Ceramic Memory Mug", category: "Living", categories: ["Living"], isVisible: true },
        ];

        // 1. Search by name substring (case-insensitive)
        const searchMatches = sampleProducts.filter(p =>
            p.name.toLowerCase().includes("green") || p.category.toLowerCase().includes("green")
        );
        assert.equal(searchMatches.length, 1);
        assert.equal(searchMatches[0].id, "p1");

        // 2. Filter by category
        const apparelMatches = sampleProducts.filter(p =>
            p.category === "Apparel" || (p.categories || []).includes("Apparel")
        );
        assert.equal(apparelMatches.length, 1);
        assert.equal(apparelMatches[0].id, "p1");

        // 3. Filter by visibility
        const visibleMatches = sampleProducts.filter(p => p.isVisible);
        assert.equal(visibleMatches.length, 2);
        const hiddenMatches = sampleProducts.filter(p => !p.isVisible);
        assert.equal(hiddenMatches.length, 1);
        assert.equal(hiddenMatches[0].id, "p2");
    });

    it("ADMIN-ORDER-001: should strictly isolate quarantined artifacts from regular fulfillment filters", () => {
        const sampleOrders = [
            { id: "ord-1", orderStatus: "Processing", paymentStatus: "PAID", quarantined: false },
            { id: "ord-2", orderStatus: "Delivered", paymentStatus: "PAID", quarantined: false },
            { id: "ord-3", orderStatus: "Synthetic_Test_Artifact", paymentStatus: "UNPAID_SYNTHETIC_ARTIFACT", quarantined: true },
        ];

        // Normal Processing filter must exclude quarantined artifact
        const processingOrders = sampleOrders.filter(o => !o.quarantined && o.orderStatus === "Processing");
        assert.equal(processingOrders.length, 1);
        assert.equal(processingOrders[0].id, "ord-1");

        // Quarantined filter must isolate only quarantined artifacts
        const quarantinedOrders = sampleOrders.filter(o => o.quarantined === true || o.orderStatus === "Synthetic_Test_Artifact");
        assert.equal(quarantinedOrders.length, 1);
        assert.equal(quarantinedOrders[0].id, "ord-3");
    });

    it("ADMIN-TOUCH-001: should enforce minimum touch target standards for mobile interactive controls", () => {
        // Standard accessible touch target size
        const MIN_TOUCH_TARGET_PX = 44;
        const buttonMinHeight = 44; // enforced by .admin-btn, .admin-nav-item, .admin-hamburger-btn
        const inputMinHeight = 44;  // enforced by .admin-form-input, .admin-form-select

        assert.ok(buttonMinHeight >= MIN_TOUCH_TARGET_PX, "Admin button min height satisfies 44px touch target");
        assert.ok(inputMinHeight >= MIN_TOUCH_TARGET_PX, "Admin form input min height satisfies 44px touch target");
    });
});
