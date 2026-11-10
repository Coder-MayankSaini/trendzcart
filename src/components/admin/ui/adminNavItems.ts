export type NavIconType = "dashboard" | "products" | "categories" | "orders" | "coupons" | "reviews";

export interface NavItem {
    label: string;
    href: string;
    icon: NavIconType;
}

export const ADMIN_NAV_ITEMS: NavItem[] = [
    {
        label: "Dashboard",
        href: "/admin/dashboard",
        icon: "dashboard",
    },
    {
        label: "Products",
        href: "/admin/products",
        icon: "products",
    },
    {
        label: "Reviews",
        href: "/admin/reviews",
        icon: "reviews",
    },
    {
        label: "Categories",
        href: "/admin/categories",
        icon: "categories",
    },
    {
        label: "Orders",
        href: "/admin/orders",
        icon: "orders",
    },
    {
        label: "Coupons",
        href: "/admin/coupons",
        icon: "coupons",
    },
];
