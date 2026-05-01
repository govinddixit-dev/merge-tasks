# Recon Report — Distributor Virtual Proofing Studio

**Date:** 2026-04-25
**Author:** session preceding Tier 1 webstore AI placement work
**Audience:** the future session that upgrades the distributor proofing
studio (Tier 2 — likely a nano-banana / higher-end image model swap)

This document exists so the boundary between the customer-facing
**webstore Tier 1 logo overlay** (Claude vision → cached coordinates
→ client-side composite) and the existing distributor-facing
**virtual proofing studio** (OpenAI Images → server-rendered raster)
stays explicit across sessions. Do NOT collapse the two paths.

---

## Surface area

### Server

| File | Role |
|---|---|
| `server/routers/proofing.ts` | tRPC router — 17 procedures (CRUD + render flow) |
| `server/_core/imageGeneration.ts` | Wraps OpenAI Images API (`generateImage`) |
| `drizzle/schema.ts` (line 476) | `virtualProofs` table — full proof records with `proofImageUrl`, `placementData` (text/JSON), `decorationMethod`, `imprintZoneId` |

### Client

| File | Role |
|---|---|
| `client/src/pages/VirtualProofing.tsx` | Standalone page at `/virtual-proofing` |
| `client/src/components/proofing/VirtualProofingViewer.tsx` | 3D viewer that displays the server-rendered proof image |
| `client/src/components/proposal/ProposalProofingPanel.tsx` | Embedded panel inside proposal builder |
| `client/src/components/proposal/ProposalStep3Proofing.tsx` | Proposal-flow step |
| `client/src/components/proposal/ProposalStep6ReviewSend.tsx` | Review/send surface |
| `client/src/components/webstore/Step7Branding.tsx` | Logo upload step in webstore wizard (uses `proofing.uploadClientLogo` only — does not render proofs) |
| `client/src/pages/CreateProposal.tsx`, `pages/ProposalEditor.tsx`, `pages/ProposalDetail.tsx`, `pages/StoreEditorPage.tsx` | Consumers of `proofing.*` tRPC procedures |

---

## AI model in use

**OpenAI** — not Claude.

- **`dall-e-3`** for text-to-image (no source image present)
- **`dall-e-2`** for image edits (when product image + logo are both supplied to `renderProof`)
- Direct `fetch()` to `https://api.openai.com/v1/images/generations` and `/v1/images/edits`
- Reads `APP_OPENAI_API_KEY` (sandbox-safe override)

`renderProof` builds a long natural-language prompt — e.g.
`"Professional product photography of a {productName} with the company's
logo embroidered with visible thread texture, raised stitching..."` —
and feeds the original product image + client logo as `originalImages`.
The model recreates the product with the decoration baked in.
Decoration-method-specific prompt fragments live in
`DECORATION_PROMPTS` (8 methods).

---

## Where it renders in the UI

- Standalone route: **`/virtual-proofing`** (sidebar entry)
- Embedded in the proposal flow: **Step 3 (Proofing) → Step 6 (Review/Send)**
- Cross-linked from store editor and proposal detail
- **Not** used on the customer-facing webstore — that's the Tier 1 path

---

## Data model

| Column | Type | Notes |
|---|---|---|
| `virtualProofs.proofImageUrl` | `text` | Final OpenAI-generated mockup, persisted in object storage |
| `virtualProofs.placementData` | `text` | JSON blob `{ x, y, width, height, rotation }` — distributor-side, fed into the prompt |
| `virtualProofs.decorationMethod` | enum (8 methods) | embroidery / screen_print / laser_engraving / heat_transfer / dtg / sublimation / deboss / patch |
| `virtualProofs.imprintZoneId` | int FK | → `productImprintZones.id` |
| `virtualProofs.status` | enum | draft / rendering / ready / approved / revision_requested |

**Stores rendered proofs** (does not regenerate per view). `renderProof`
flips `status: rendering` → calls OpenAI → writes `proofImageUrl` →
flips to `ready`. `bulkRender` covers multi-product proposals;
`reviseProof` handles edits. Plan limits via
`checkProofMonthlyLimit`; rate limits via `PROOFING_RENDER_LIMIT` /
`PROOFING_BULK_LIMIT`.

---

## How Tier 1 webstore differs

| | Tier 1 webstore (this session) | Distributor proofing (NOT this session) |
|---|---|---|
| Model | Claude Sonnet vision via `invokeLLM` / `anthropicAdapter` | OpenAI dall-e-3 / dall-e-2 |
| Output | Coordinates (`x/y/w/h/zone/blend/confidence`) | Rendered raster image URL |
| Composition | Client-side CSS overlay (`WebstoreLogoOverlay.tsx`) | Server-side image generation |
| Trigger | Automatic at product ingestion | Manual, on-demand from proposal flow |
| Storage | New `webstore_imprint_placement_*` columns on `products` | Existing `virtualProofs` table |
| Audience | End customers on the storefront | Distributors building proposals |

The two systems are **intentionally separate** — different cost
profile, different latency profile, different audiences. A future
session is expected to swap the proofing studio's OpenAI calls for a
higher-end model (e.g., nano-banana / Imagen-class) without touching
the webstore overlay path. **Do not unify them.**

---

## Files that MUST stay untouched in the Tier 1 work

- `server/routers/proofing.ts`
- `server/_core/imageGeneration.ts`
- `drizzle/schema.ts:virtualProofs` (existing columns and shape)
- `client/src/pages/VirtualProofing.tsx`
- `client/src/components/proofing/VirtualProofingViewer.tsx`
- `client/src/components/proposal/ProposalProofingPanel.tsx`
- `client/src/components/proposal/ProposalStep3Proofing.tsx`
- `client/src/components/proposal/ProposalStep6ReviewSend.tsx`
- All `proofing.*` tRPC procedure call sites
- `client/src/pages/webstore/LogoOverlay.tsx` — kept as-is so the
  distributor-side `ImprintZoneEditor` preview keeps working.

The Tier 1 path will fork **`WebstoreLogoOverlay.tsx`** for the
customer-facing storefront and add `webstore_imprint_placement_*`
columns to `products` (explicit `webstore_` prefix to prevent any
future cross-contamination with the proofing data model).
