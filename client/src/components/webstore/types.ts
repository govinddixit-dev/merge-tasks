/**
 * Shared types for the CreateWebstore wizard step components
 */

export interface PocEntry {
  name: string;
  email: string;
}

export interface StoreEmployee {
  name: string;
  email: string;
  /** Job role within the company (e.g. "manager", "employee") */
  role: string;
  /** Department the employee belongs to (e.g. "marketing", "finance") */
  department: string;
  /** Whether this employee is the Point of Contact for the store */
  isPoc: boolean;
}

export const EMPLOYEE_DEPARTMENTS = [
  { id: "marketing", name: "Marketing" },
  { id: "finance", name: "Finance" },
  { id: "hr", name: "HR" },
  { id: "operations", name: "Operations" },
  { id: "sales", name: "Sales" },
  { id: "it", name: "IT" },
  { id: "executive", name: "Executive" },
  { id: "procurement", name: "Procurement" },
  { id: "legal", name: "Legal" },
  { id: "events", name: "Events" },
];

export const EMPLOYEE_ROLES = [
  { id: "employee", name: "Employee" },
  { id: "manager", name: "Manager" },
  { id: "admin", name: "Admin" },
  { id: "intern", name: "Intern" },
  { id: "contractor", name: "Contractor" },
];

export interface RbacTier {
  name: string;
  methods: string[];
  limit: string;
}

export interface PermanentStore {
  id: string;
  name: string;
  domain: string;
}

export const INDUSTRIES = [
  "Technology", "Healthcare", "Finance", "Manufacturing", "Retail",
  "Education", "Real Estate", "Hospitality", "Non-Profit", "Other"
];

export const BRAND_COLORS = [
  "var(--mt-brand)", "#2563EB", "#059669", "#DC2626", "#D97706", "#7C3AED", "#0891B2", "#1A1A1A"
];

export const TEMPLATES = [
  {
    id: "classic",
    name: "Classic",
    desc: "Traditional grid layout with sidebar navigation. Best for large catalogs with many categories.",
  },
  {
    id: "modern",
    name: "Modern",
    desc: "Full-width hero with card-based browsing. Ideal for curated collections and featured products.",
  },
  {
    id: "minimal",
    name: "Minimal",
    desc: "Clean single-column flow with large imagery. Perfect for premium brands with fewer SKUs.",
  },
];

export const CATALOG_CATEGORIES = [
  { id: "apparel", name: "Apparel", count: 156 },
  { id: "drinkware", name: "Drinkware", count: 89 },
  { id: "tech", name: "Tech Accessories", count: 72 },
  { id: "office", name: "Office Supplies", count: 64 },
  { id: "bags", name: "Bags & Totes", count: 48 },
  { id: "wellness", name: "Health & Wellness", count: 35 },
];

export const CHECKOUT_METHODS = [
  { id: "cc", name: "Credit Card", desc: "Stripe direct charge to distributor" },
  { id: "gl", name: "GL-Code / PO Number", desc: "Net-30 invoice, enterprise procurement" },
  { id: "points", name: "Company Points", desc: "Points loaded via CSV or API" },
  { id: "hybrid", name: "Hybrid (Points + CC)", desc: "Points cover partial cost, remainder charged" },
];

export const RBAC_TIERS: RbacTier[] = [
  { name: "Executive", methods: ["cc", "gl", "points"], limit: "Unlimited" },
  { name: "Manager", methods: ["cc", "gl"], limit: "$5,000/order" },
  { name: "Employee", methods: ["cc", "points"], limit: "$500/order" },
  { name: "Intern", methods: ["points"], limit: "$100/order" },
];

export const SSO_PROVIDERS = [
  { id: "microsoft", name: "Microsoft Entra ID", protocol: "SAML 2.0 / OIDC", desc: "For organizations using Microsoft 365 / Azure AD" },
  { id: "okta", name: "Okta", protocol: "SAML 2.0 / OIDC", desc: "For organizations using Okta as their IdP" },
  { id: "google", name: "Google Workspace", protocol: "OIDC", desc: "For organizations using Google Workspace" },
  { id: "none", name: "Email / Password", protocol: "No SSO", desc: "Simple login — no IT department required" },
];
