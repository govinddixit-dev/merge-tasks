// content/privacy-en.ts
// Source of truth: MergeTasks_Privacy_Policy_EN.pdf — Effective Date: April 8, 2026

export const privacyEN = {
  title: "Privacy Policy",
  subtitle: "MergeTasks Platform",
  effectiveDate: "Effective Date: April 8, 2026",
  summaryBox: {
    heading: "Privacy at a Glance",
    points: [
      "We collect only what we need to provide the MergeTasks platform.",
      "We encrypt your sensitive data using industry-standard AES-256-GCM encryption.",
      "We never sell your personal information — to anyone, for any reason.",
      "You own your data. You can export or delete it at any time.",
      "When we process data on behalf of Distributors, we act strictly as a processor under their instructions.",
    ],
  },
  intro: "MergeTasks (\"MergeTasks,\" \"we,\" \"us,\" or \"our\") is a Canadian company headquartered in Ontario, Canada. We operate a software-as-a-service (SaaS) platform designed for promotional products distributors in North America. This Privacy Policy describes how we collect, use, disclose, and protect personal information when you use our platform, website, and related services (collectively, the \"Platform\"). This Privacy Policy applies to all users of the Platform, including Distributors (our direct customers), their clients, and end users who interact with Distributor-operated webstores. We are committed to protecting your privacy and handling your personal information transparently and in accordance with applicable privacy laws, including the Personal Information Protection and Electronic Documents Act (PIPEDA), the California Consumer Privacy Act as amended by the California Privacy Rights Act (CCPA/CPRA), and the General Data Protection Regulation (GDPR) for any future European operations. If you have questions or concerns about this Privacy Policy or our data practices, please contact us at privacy@mergetasks.com.",
  sections: [
    {
      number: "1",
      title: "Information We Collect",
      content: [
        { number: "1.1", text: "Information You Provide Directly — Distributor Account Information. When a Distributor registers for the Platform, we collect: full name and email address; password (stored only as a bcrypt hash — we never store plaintext passwords); organization name, mailing address, and phone number; billing information processed via Stripe (Stripe customer ID and subscription details); Stripe Connect account ID for payment processing; SMTP credentials for sending transactional emails from the Distributor's domain (encrypted with AES-256-GCM at rest)." },
        { number: "1.2", text: "End User Information. End users of Distributor-operated webstores may provide: email address (used for store login via one-time passcode or single sign-on); name, department, and role (if provided by SSO identity provider or entered manually); order details and product selections." },
        { number: "1.3", text: "Information Collected Automatically. When you use the Platform, we automatically collect certain technical and usage information: login timestamps and session activity; feature usage patterns and AI copilot interaction history; device information, browser type, and operating system; IP address and approximate geographic location; error and performance data (collected via Sentry for debugging and reliability improvement)." },
        { number: "1.4", text: "Information from Third-Party Services. We receive limited information from the following third-party services when authorized by the user: Stripe (payment transaction IDs, subscription status, and Connect account status — MergeTasks never receives or stores raw credit card numbers); QuickBooks Online (customer records, invoice records, payment records, and company information — accessed only when explicitly authorized by the Distributor through OAuth 2.0 consent); SSO Identity Providers (email address, name, and optionally department and role attributes — MergeTasks never receives or stores the user's identity provider password); OpenAI (prompts and responses generated through AI copilot features — OpenAI processes these prompts under its API data usage policy)." },
        { number: "1.5", text: "Information We Process on Behalf of Distributors. When Distributors use the Platform to manage their business, we process certain data on their behalf. In this context, the Distributor is the data controller and MergeTasks acts as a data processor. This data includes: client company name, contact name, email, phone, and address; proposal and order history; invoice data (amounts, line items, payment status); product preferences and order patterns; end user spending limits and points balances; end user order history within Distributor-operated webstores; SSO identity information: unique subject identifiers and provider IDs." },
      ],
    },
    {
      number: "2",
      title: "How We Use Your Information",
      content: [
        { number: "2.1", text: "Providing and Operating the Platform. To create and maintain your account, deliver the features and services you request, and administer Distributor-operated webstores." },
        { number: "2.2", text: "Payment Processing. To process subscription payments and facilitate transactions between Distributors and their end users through Stripe." },
        { number: "2.3", text: "Accounting Data Synchronization. To sync customer, invoice, estimate, and payment data between MergeTasks and a Distributor's QuickBooks Online account, at the Distributor's direction and authorization." },
        { number: "2.4", text: "User Authentication. To verify your identity via email/one-time passcode, password authentication, or SSO through your organization's identity provider." },
        { number: "2.5", text: "Transactional Communications. To send order confirmations, one-time passcodes, refund notifications, and other service-related messages." },
        { number: "2.6", text: "Platform Improvement. To analyze usage patterns, monitor errors (via Sentry), and improve the reliability, performance, and features of the Platform." },
        { number: "2.7", text: "AI-Powered Features. To generate content suggestions, virtual product proofs, and store optimization recommendations using OpenAI. These features process product and business context — personal data is not intentionally included in AI prompts." },
        { number: "2.8", text: "Security and Abuse Prevention. To enforce our Terms of Service, prevent fraud, detect unauthorized access, and protect the security of the Platform and its users." },
        { number: "2.9", text: "Legal Compliance. To comply with applicable laws, regulations, legal processes, and enforceable governmental requests." },
      ],
    },
    {
      number: "3",
      title: "How We Share Your Information",
      content: [
        { number: "3.1", text: "We do not sell personal information. MergeTasks has never sold personal information and has no plans to do so. This applies to all categories of personal information we collect, for all users." },
        { number: "3.2", text: "Service Providers. We share personal information with trusted third-party service providers who perform services on our behalf, subject to contractual obligations to protect your data: Stripe (payment processing and subscription management); OpenAI (AI copilot features — product/business context only); Sentry (error monitoring and application performance management); SMTP Providers (transactional email delivery using Distributor-configured credentials)." },
        { number: "3.3", text: "At Distributor's Direction. When a Distributor authorizes a third-party integration, we share data as instructed: QuickBooks Online (customer, invoice, and payment data synced bidirectionally at the Distributor's explicit authorization); SSO Identity Providers (authentication requests and attribute exchange as configured by the Distributor)." },
        { number: "3.4", text: "Legal Requirements. We may disclose personal information if required to do so by law, or in the good-faith belief that such action is necessary to comply with a legal obligation, protect and defend our rights or property, prevent fraud, act in urgent circumstances to protect personal safety, or respond to a court order, subpoena, or other lawful governmental request." },
        { number: "3.5", text: "Business Transfers. In connection with a merger, acquisition, reorganization, sale of assets, or bankruptcy, personal information may be transferred to the acquiring entity. We will provide notice before your personal information becomes subject to a different privacy policy." },
        { number: "3.6", text: "Aggregated and Anonymized Data. We may use aggregated or de-identified data for benchmarking, product improvement, and industry analysis. This data does not identify any individual and is not subject to the restrictions of this Privacy Policy." },
      ],
    },
    {
      number: "4",
      title: "Data Processing Roles",
      content: [
        { number: "4.1", text: "MergeTasks as Data Controller. MergeTasks acts as the data controller for: Distributor account registration and profile data; Platform usage data and analytics; billing and subscription information; communications between MergeTasks and Distributors." },
        { number: "4.2", text: "MergeTasks as Data Processor. MergeTasks acts as a data processor for: Distributor's client data (company information, contacts, proposals, orders, invoices); end user data in Distributor-operated webstores (profiles, orders, spending limits, points balances); data synced to or from QuickBooks Online at the Distributor's direction; SSO identity attributes received from the Distributor's configured identity provider." },
        { number: "4.3", text: "Distributor Responsibilities. Distributors, as data controllers of their client and end user data, are responsible for: obtaining all necessary consents or establishing a lawful basis for processing their clients' and end users' personal information through the Platform; providing appropriate privacy notices to their clients and end users; responding to data subject access requests relating to data they control; ensuring that any data synced with QuickBooks or processed through SSO integrations complies with applicable privacy laws." },
        { number: "4.4", text: "QuickBooks Data Processing. Access to a Distributor's QuickBooks Online data requires the Distributor's explicit OAuth 2.0 authorization. OAuth access tokens and refresh tokens are encrypted with AES-256-GCM at rest. Data is synced only within the scope of the authorized permissions. Upon disconnection, sync mappings and cached QuickBooks data are deleted. MergeTasks does not access, use, or retain QuickBooks data for any purpose other than providing the requested synchronization service to the Distributor." },
      ],
    },
    {
      number: "5",
      title: "Third-Party Services and Integrations",
      content: [
        { number: "5.1", text: "Stripe. Stripe processes all payment transactions on the Platform. MergeTasks stores Stripe customer IDs, subscription identifiers, Connect account IDs, and transaction references — but never raw credit card numbers, CVVs, or other sensitive payment card data. All card data is handled exclusively within Stripe's PCI DSS-compliant infrastructure. Stripe Privacy Policy: https://stripe.com/privacy" },
        { number: "5.2", text: "QuickBooks Online (Intuit). QuickBooks Online integration enables bidirectional synchronization of customer, invoice, estimate, and payment data between MergeTasks and the Distributor's QuickBooks company file. Integration requires the Distributor's explicit OAuth 2.0 authorization. OAuth tokens are encrypted with AES-256-GCM at rest and transmitted over TLS 1.2+. The Distributor retains full control and can revoke access at any time. Upon disconnection, all sync mappings and cached QuickBooks data are promptly deleted. Intuit Privacy Statement: https://www.intuit.com/privacy/" },
        { number: "5.3", text: "SSO Identity Providers (Okta, Microsoft Azure AD, Google Workspace). Distributors may configure SSO to authenticate their end users via SAML 2.0 or OpenID Connect (OIDC) protocols. MergeTasks receives the user's email address, name, and optionally department and role attributes. MergeTasks does not receive, store, or have access to the user's identity provider password. SSO client secrets are encrypted with AES-256-GCM at rest." },
        { number: "5.4", text: "OpenAI. OpenAI powers the Platform's AI copilot features. Prompts sent to OpenAI contain product catalog information and business context. No personal data is intentionally included in prompts. OpenAI processes data under its API Terms of Service and does not use API inputs for model training. OpenAI Usage Policies: https://openai.com/policies/usage-policies" },
      ],
    },
    {
      number: "6",
      title: "Data Security",
      content: [
        { number: "6.1", text: "Encryption. At rest: OAuth tokens, SMTP credentials, and SSO client secrets are encrypted with AES-256-GCM. In transit: All data is transmitted over TLS 1.2 or higher. Passwords: Stored as bcrypt hashes — never in plaintext. One-time passcodes: Hashed with SHA-256 before storage." },
        { number: "6.2", text: "Access Controls. Role-based access controls with organization-scoped data isolation (multi-tenancy). Per-account lockout after 10 consecutive failed login attempts. Short-lived session tokens (15-minute access tokens, 7-day refresh tokens) with server-side revocation. CSRF protection using the double-submit cookie pattern. Redis-backed rate limiting in production environments." },
        { number: "6.3", text: "Monitoring and Logging. Comprehensive audit logging for authentication events, payment configuration changes, data exports, and SSO events. Error monitoring via Sentry for rapid identification and remediation of issues. Regular security reviews of the codebase and infrastructure." },
        { number: "6.4", text: "Breach Notification. In the event of a data breach that affects your personal information, we will notify affected users and applicable regulatory authorities within 72 hours of becoming aware of the breach, in accordance with PIPEDA, CCPA/CPRA, and GDPR requirements." },
      ],
    },
    {
      number: "7",
      title: "Data Retention",
      content: [
        { number: "7.1", text: "We retain personal information only for as long as necessary to fulfill the purposes described in this Privacy Policy, or as required by law. Retention periods: Account data — active account period + 90 days after termination; Verification codes (OTP) — automatically deleted after expiry (cleanup runs every 6 hours); Refresh tokens — automatically deleted 7 days after expiry; Audit logs — minimum 90 days; QuickBooks sync mappings — deleted when Distributor disconnects QuickBooks; SSO provider configurations — deleted when Distributor removes the SSO connection; Stripe transaction references — retained as required by applicable financial record-keeping laws; Distributor client/end user data — retained while Distributor account is active; deleted per Distributor instructions or upon account termination + 90 days." },
      ],
    },
    {
      number: "8",
      title: "Your Privacy Rights",
      content: [
        { number: "8.1", text: "Rights Available to All Users. Right to Access: you may request a copy of the personal information we hold about you. Right to Correction: you may request correction of inaccurate or incomplete personal information. Right to Deletion: you may request deletion of your account and associated personal data, subject to legal retention requirements. Right to Data Portability: you may request an export of your data in a structured, commonly used, machine-readable format. Right to Withdraw Consent: where processing is based on consent, you may withdraw that consent at any time." },
        { number: "8.2", text: "Additional Rights for Canadian Users (PIPEDA). Under Canada's Personal Information Protection and Electronic Documents Act (PIPEDA), you have the right to know what personal information we hold about you and how it is used; challenge the accuracy and completeness of your personal information; withdraw consent for the collection, use, or disclosure of your personal information. If you are not satisfied with our response, you may file a complaint with the Office of the Privacy Commissioner of Canada at www.priv.gc.ca." },
        { number: "8.3", text: "Additional Rights for California Residents (CCPA/CPRA). Right to Know, Right to Delete, Right to Opt-Out of Sale (we do not sell personal information), Right to Non-Discrimination, Right to Correct, and Right to Limit Use of Sensitive Personal Information." },
        { number: "8.4", text: "How to Exercise Your Rights. Email us at privacy@mergetasks.com. Include your full name, email address associated with your account, and a description of your request. We will respond within 30 days for PIPEDA or GDPR requests, and within 45 calendar days for CCPA/CPRA requests." },
      ],
    },
    {
      number: "9",
      title: "Cookies and Tracking Technologies",
      content: [
        { number: "9.1", text: "Essential Cookies. The Platform uses the following essential cookies: session tokens (httpOnly, secure, SameSite cookies that authenticate your session) and CSRF tokens (double-submit cookies that protect against cross-site request forgery attacks). These cookies cannot be disabled without breaking core Platform functionality." },
        { number: "9.2", text: "What We Do Not Use. We do not use advertising cookies or retargeting pixels. We do not use third-party analytics services such as Google Analytics or Facebook Pixel. We do not engage in cross-site tracking." },
        { number: "9.3", text: "Server-Side Analytics. We collect usage analytics on the server side only (login frequency, feature usage, error rates). This data is used to improve the Platform and does not involve third-party tracking cookies in your browser." },
        { number: "9.4", text: "Error Monitoring. Sentry collects device type, browser version, operating system, and error stack traces for debugging purposes. This data is used solely to identify and fix software defects." },
      ],
    },
    {
      number: "10",
      title: "Children's Privacy",
      content: [
        { number: "10.1", text: "The Platform is designed for business use and is not directed to children under the age of 16. We do not knowingly collect personal information from children under 16. If we become aware that we have inadvertently collected personal information from a child under 16, we will take prompt steps to delete that information. If you believe a child has provided us with personal information, please contact us at privacy@mergetasks.com." },
      ],
    },
    {
      number: "11",
      title: "International Data Transfers",
      content: [
        { number: "11.1", text: "MergeTasks is headquartered in Ontario, Canada. The Platform is hosted in North America, and your personal information may be processed in Canada and the United States. Certain service providers process data in the United States, including Stripe (payments), OpenAI (AI features), and Intuit/QuickBooks (accounting sync). We maintain standard contractual protections with these providers." },
        { number: "11.2", text: "Canadian Users. Transfers of personal information to the United States comply with PIPEDA's accountability principle. MergeTasks remains accountable for the protection of your personal information regardless of where it is processed." },
        { number: "11.3", text: "Users Outside North America. If you access the Platform from outside North America, you acknowledge and consent to the transfer of your personal information to Canada and the United States." },
      ],
    },
    {
      number: "12",
      title: "Changes to This Privacy Policy",
      content: [
        { number: "12.1", text: "We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or for other operational reasons. If we make material changes, we will provide at least 30 days' advance notice via email or through a prominent in-app notification before the changes take effect. Your continued use of the Platform after the effective date of any updated Privacy Policy constitutes your acceptance of the changes." },
      ],
    },
    {
      number: "13",
      title: "Contact Us",
      content: [
        { number: "13.1", text: "If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us: MergeTasks — Ontario, Canada — Privacy Inquiries: privacy@mergetasks.com — General Support: support@mergetasks.com — Last updated: April 8, 2026." },
      ],
    },
  ],
};
