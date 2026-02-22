"use client";

import { createContext, useContext, useState, ReactNode, useEffect } from "react";

export interface CartItem {
    id: string; // Unique ID for cart item (product.id + custom data hash conceptually)
    productId: string;
    name: string;
    price: number;
    quantity: number;
    image: string;
    isCustomized: boolean;
    customizationData?: {
        name?: string;
        pictureUrl?: string; // Firebase Storage URL
    };
}

interface CartContextType {
    items: CartItem[];
    addToCart: (item: CartItem) => void;
    removeFromCart: (id: string) => void;
    updateQuantity: (id: string, quantity: number) => void;
    clearCart: () => void;
    cartTotal: number;
    cartCount: number;
}

const CartContext = createContext<CartContextType>({
    items: [],
    addToCart: () => { },
    removeFromCart: () => { },
    updateQuantity: () => { },
    clearCart: () => { },
    cartTotal: 0,
    cartCount: 0,
});

export const CartProvider = ({ children }: { children: ReactNode }) => {
    const [items, setItems] = useState<CartItem[]>([]);

    // Simple local storage persistence
    useEffect(() => {
        const saved = localStorage.getItem("trendkartz_cart");
        if (saved) {
            try {
                setItems(JSON.parse(saved));
            } catch (e) {
                console.error("Failed to parse cart", e);
            }
        }
    }, []);

    useEffect(() => {
        localStorage.setItem("trendkartz_cart", JSON.stringify(items));
    }, [items]);

    const addToCart = (newItem: CartItem) => {
        setItems(current => {
            // Check if exact same item exists (including custom data)
            const existingIndex = current.findIndex(
                i => i.productId === newItem.productId &&
                    JSON.stringify(i.customizationData) === JSON.stringify(newItem.customizationData)
            );

            if (existingIndex > -1) {
                const updated = [...current];
                updated[existingIndex].quantity += newItem.quantity;
                return updated;
            }
            return [...current, newItem];
        });
    };

    const removeFromCart = (id: string) => {
        setItems(current => current.filter(i => i.id !== id));
    };

    const updateQuantity = (id: string, quantity: number) => {
        if (quantity < 1) return;
        setItems(current =>
            current.map(i => i.id === id ? { ...i, quantity } : i)
        );
    };

    const clearCart = () => {
        setItems([]);
    };

    const cartTotal = items.reduce((total, item) => total + (item.price * item.quantity), 0);
    const cartCount = items.reduce((count, item) => count + item.quantity, 0);

    return (
        <CartContext.Provider value={{
            items, addToCart, removeFromCart, updateQuantity, clearCart, cartTotal, cartCount
        }}>
            {children}
        </CartContext.Provider>
    );
};

export const useCart = () => useContext(CartContext);
