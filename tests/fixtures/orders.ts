/**
 * Synthetic Order Fixtures for Firebase Emulator Integration Tests
 */

export interface TestShippingAddress {
    fullName: string;
    email: string;
    phone: string;
    addressLine1: string;
    city: string;
    state: string;
    pincode: string;
}

export const SYNTHETIC_SHIPPING_ADDRESS: TestShippingAddress = {
    fullName: "Jane Synthetic Customer",
    email: "jane.synthetic@example.com",
    phone: "9876543210",
    addressLine1: "123 Synthetic Boulevard, Suite 4",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560001",
};

export const EXISTING_SYNTHETIC_ORDER = {
    id: "ord-existing-victim-999",
    userId: "user-victim-123",
    items: [
        {
            id: "item-victim-1",
            productId: "prod-hoodie-1000",
            name: "Synthetic Demo Hoodie",
            price: 1000,
            quantity: 1,
            itemSubtotal: 1000,
            isCustomized: false,
        },
    ],
    subtotal: 1000,
    discount: 0,
    couponDiscount: 0,
    total: 1000,
    couponCode: null,
    paymentMethod: "COD" as const,
    paymentStatus: "PENDING",
    orderStatus: "Processing",
    shippingAddress: {
        fullName: "Victim Customer",
        email: "victim@example.com",
        phone: "9123456780",
        addressLine1: "999 Victim Court",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
};
