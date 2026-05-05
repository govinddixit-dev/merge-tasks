# Nano-banana Tier 1 Resume Prompt

Resuming MergeTasks — starting nano-banana Tier 1 photorealistic render pipeline.

Phase 6 is shipped and CI-green (commit 6644435). Read these before doing anything:
- docs/tier1-webstore-resume-prompt.md
- docs/virtual-proofing-recon.md
- docs/tier1-phase6-architecture-finding.md
- docs/migration-audit-followups.md

## Context

The goal is to upgrade the customer-facing webstore from CSS overlay logo placement to photorealistic nano-banana rendered product images.

- nano-banana = gemini-3.1-flash-image-preview (or gemini-2.5-flash-image if 3.1 unavailable)
- GEMINI_API_KEY is already in .env (confirmed working)
- Redis is running, BullMQ v5.75.2 already installed
- Existing Gemini integration is text-only via OpenAI shim — do NOT touch it
- nano-banana requires native generativelanguage.googleapis.com API, NOT the OpenAI-compatible endpoint
- The existing invokeLLM path cannot reach image generation endpoints — confirmed in Phase 6 session

## Architecture (fully designed, needs implementation)

### Step 1 — server/services/nano-banana.ts
Direct fetch to:
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent
Authorization: Bearer {ENV.geminiApiKey}

Input: product image URL + processed logo URL + placement coordinates + decoration method
Output: rendered image bytes → uploaded to S3 → returns S3 URL
Decoration-aware prompt: embroidery shows thread texture, screen print shows ink layering, laser shows debossed depth, heat transfer shows clean flat application
On failure: return null, log error, never block the pipeline

### Step 2 — Schema migration 0098
Add to products table:
- webstoreRenderedImageUrl text nullable
- webstoreRenderedAt timestamp nullable
- webstoreRenderDecoration varchar(50) nullable
- webstoreRenderStatus enum('pending','rendering','complete','failed') default null

Follow the same migration conventions as 0096 and 0097. Show migration SQL before running.

### Step 3 — server/queues/webstore-render-queue.ts
BullMQ queue definition:
- Queue name: webstore-product-render
- Job data: { productId, logoUrl, placementData, decorationMethod }
- Concurrency: 5 workers (conservative — nano-banana renders take 3-8 seconds each)
- Retry: 3 attempts with exponential backoff
- Dead letter queue for permanently failed jobs

### Step 4 — server/workers/webstore-render-worker.ts
BullMQ worker that:
- Picks up render jobs from the queue
- Calls nano-banana.ts service
- Uploads rendered image to S3
- Updates products table (webstoreRenderedImageUrl, webstoreRenderedAt, webstoreRenderStatus)
- Wired into pm2 as a separate named process alongside the main server
- Do NOT restart the main production process when starting the worker

### Step 5 — Phase 5 hook addition
After AI placement coordinates are stored (existing Phase 5 hooks in products.ts and copilotExecProducts.ts), if coordinates exist AND the product has an imageUrl AND a logoUrl is available for the webstore, enqueue a render job.

### Step 6 — WebstoreLogoOverlay upgrade
In client/src/pages/webstore/WebstoreLogoOverlay.tsx:
- If product.webstoreRenderedImageUrl exists AND webstoreRenderStatus === 'complete': show the rendered image as a simple <img> replacing the entire product image (the rendered image IS the product with the logo baked in)
- If status === 'pending' or 'rendering': show CSS overlay fallback + a subtle "Preview rendering..." indicator
- If status === 'failed' or null: show CSS overlay fallback silently
- No page refresh needed — rendered image is available on next product query after worker completes

### Step 7 — Phase 8-lite with renders
Backfill script enqueues render jobs for all products that:
- Appear on at least one active webstore
- Have webstoreImprintPlacementAnalyzedAt IS NOT NULL (placement coordinates exist)
- Have webstoreRenderStatus IS NULL (not yet rendered)

Report count before running. Hold for approval before running.

### Step 8 — Regression + commit + CI green
Full regression protocol (pnpm check, pnpm test, pnpm build).
Commit message: feat(webstore): nano-banana Tier 1 photorealistic render pipeline
Push to origin/main. Wait for CI green.

## Implementation order

Start with Step 1. Read server/_core/env.ts to confirm ENV.geminiApiKey access pattern before writing the adapter. Show the proposed nano-banana.ts before creating the file. Hold for approval at each step.

## Constraints

- Do NOT touch server/routers/proofing.ts or any proofing studio files
- Do NOT touch the existing invokeLLM path
- Do NOT restart pm2 or reload the production process without explicit approval
- Do NOT run pnpm build without explicit approval (production runs on this EC2)
- Show proposed changes before applying
- Hold for approval at each step
- pnpm check after every file change
- CI must be green between major phases
- The nano-banana adapter is a NEW file — do not modify existing LLM infrastructure

## Cost context

- nano-banana render: ~$0.039 per product (one-time, cached forever)
- At $149-600/month per distributor, render cost is <0.3% of revenue per customer
- Batch API option available: ~$0.02/render with 24-hour processing window (use for backfill)
