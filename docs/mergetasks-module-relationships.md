## MergeTasks – Module Relationships (Mermaid)

Paste into any Mermaid renderer (or view on GitHub).

```mermaid
flowchart LR
  %% MergeTasks – Module Relationships (Clients / Proposals / Stores / Orders)

  %% ---------- Styles ----------
  classDef core fill:#e8f1ff,stroke:#2563eb,stroke-width:1.5px,color:#0f172a;
  classDef flow fill:#f3e8ff,stroke:#7c3aed,stroke-width:1.5px,color:#0f172a;
  classDef commerce fill:#ecfdf5,stroke:#16a34a,stroke-width:1.5px,color:#0f172a;
  classDef service fill:#fff7ed,stroke:#f97316,stroke-width:1.5px,color:#0f172a;
  classDef legend fill:#f8fafc,stroke:#94a3b8,stroke-dasharray:4 3,color:#0f172a;

  linkStyle default stroke:#64748b,stroke-width:1.3px;

  %% ---------- Auth & Tenancy ----------
  subgraph TENANCY["Auth & Tenancy"]
    direction TB
    U["Users (distributor/admin)"]:::core
    OM["Org Members (roles)"]:::core
    O["Organizations (multi-tenant)"]:::core
    U --- OM --- O
  end

  %% ---------- Core CRM ----------
  subgraph CRM["Core CRM"]
    direction TB
    CL["Clients (company + contacts + assets)"]:::core
  end

  %% ---------- Shared Catalog ----------
  subgraph CATALOG["Shared Catalog"]
    direction TB
    PD["Products (catalog)"]:::core
  end

  %% ---------- Sales / Proposals ----------
  subgraph SALES["Sales / Proposals"]
    direction TB
    PR["Proposals (quote / workflow)"]:::flow
    PP["Proposal Products"]:::flow
    DA["Department Approvals"]:::flow
    PR --> PP
    PR --> DA
  end

  %% ---------- Webstores ----------
  subgraph STOREFRONT["Webstores"]
    direction TB
    ST["Stores (branded webstore)"]:::flow
    SP["Store Products"]:::flow
    SU["Store Users / SSO"]:::flow
    ST --> SP
    ST --> SU
  end

  %% ---------- Commerce ----------
  subgraph COMMERCE["Commerce"]
    direction TB
    OR["Orders"]:::commerce
    OI["Order Items"]:::commerce
    OR --> OI
  end

  %% ---------- Services ----------
  subgraph SERVICES["Services / Integrations"]
    direction TB
    EM["Email (Resend + SMTP/OAuth)"]:::service
    PAY["Payments (Stripe + Connect)"]:::service
    AI["AI Copilot (Anthropic to Gemini fallback)"]:::service
  end

  %% ---------- Relationships ----------
  U -->|owns| CL
  O -->|scopes| CL

  CL --> PR
  CL --> ST

  PD --> PP
  PD --> SP

  ST --> OR
  PR -. optional_checkout .-> OR

  EM -. two_factor_verification .-> U
  EM -. proposal_notifications .-> PR

  PAY -. checkout .-> OR
  PAY -. connect_onboarding .-> PR
  PAY -. connect_onboarding .-> ST

  AI ..> CL
  AI ..> PD
  AI ..> PR
  AI ..> OR

  %% ---------- Legend ----------
  subgraph LEGEND["Legend"]
    direction LR
    L1["solid = primary relationship"]:::legend
    L2["dashed = optional flow"]:::legend
    L3["dotted = AI assist"]:::legend
  end
```

