# Phase 7 — Render Manager E2E Click-Through Checklist

A human-verifiable walkthrough of the distributor approval gate. Run the
setup script first; this checklist exercises every action exposed by the
Renders tab against deterministic seeded data.

## Prerequisites

```bash
DATABASE_URL=… npx tsx scripts/phase7-e2e-setup.ts
```

The setup script prints a `storeId` and the storeProductId-to-state map.
Note the `storeId` — every URL below uses it.

| Resource | Marker |
|---|---|
| user openId | `test-p7-e2e-user` |
| client | "Phase 7 E2E Test Client" |
| store slug | `phase-7-e2e-test-store` |
| products | SKU prefix `P7-E2E-` |

The seeded state matrix:

| State | Count | What seeded it |
|---|---|---|
| Pending Review | 3 | `renderStatus='complete'` + `renderApproved=false` (Polo, Tote, Crew Tee) |
| Failed | 1 | `renderStatus='failed'` (Athletic Jersey) |
| Approved | 1 | `renderStatus='complete'` + `renderApproved=true` (Structured Cap) |
| No Render | 1 | `renderStatus='pending'`, no `renderUrl` (Soft Tee) |

## Walkthrough

### Section A — Filter & default state

- [ ] Sign in as the test distributor (or impersonate `test-p7-e2e-user`). Navigate to **Store Management** → click into the seeded store → click the **Renders** tab.
- [ ] **Filter pills count match seed:** Pending Review **3**, Approved **1**, Failed **1**, Rendering **0**, No Render **1**, All **6**.
- [ ] **Default filter is Pending Review** (purple pill active on first land). The grid shows 3 cards.
- [ ] Click **All** — 6 cards visible, sorted Pending Review first → Failed → Approved → Rendering → No Render.

### Section B — Single-card actions

- [ ] Click **Approve** on the **Performance Polo** card. Toast: "Render approved · Now live on webstore." The card disappears from the Pending Review filter and re-appears under Approved. Counts update: Pending Review 2, Approved 2.
- [ ] On the **Cotton Tote** card, click **Re-render**. Modal opens with the product name + SKU header.
- [ ] In the modal, type `make logo 30% smaller`. Click **Queue re-render**. Toast: "Re-render queued". Card status flips to **Rendering** (or stays Pending Review if the worker is paused — both are valid).
- [ ] Re-open the same card's Re-render modal. The textarea is **pre-filled with `make logo 30% smaller`** (persistence verification — the prompt adjustment was saved on the binding).
- [ ] Cancel the modal.

### Section C — Override flow

- [ ] On the **Crew Tee** card, click **Upload Override**. File picker opens. Select any local JPG/PNG ≤ 5MB.
- [ ] Toast: "Manual override uploaded and approved". Card now shows the **purple "Manual Override" badge** in the right preview tile. Status flips to Approved.
- [ ] **Verify size guard**: try uploading a file > 5MB. Toast: "Override image must be 5MB or smaller". Nothing changes server-side.
- [ ] **Verify mimeType guard**: try uploading a `.gif` or `.txt`. Toast: "Use a JPG, PNG, or WebP image". Nothing changes.
- [ ] Click **Remove Override** on the Crew Tee card. Toast: "Override removed — showing AI render" (because the AI render still exists from the seed).
- [ ] Card reverts to the AI render preview, **stays Approved** (the prior approval covered the AI render too — this is the documented behavior).

### Section D — Bulk actions

- [ ] Switch filter back to **Pending Review** (counts: should be 0 now if Cotton Tote was re-rendered + Crew Tee approved via override; otherwise 1).
- [ ] If any pending remain, click **Approve All Pending**. Toast shows the count. All flip to Approved.
- [ ] Switch filter to **Failed**. The **Athletic Jersey** card should be visible.
- [ ] Click **Re-render All Failed**. Toast: "1 render re-queued". The Athletic Jersey card status flips to Rendering or Pending. Filter count: Failed 0.
- [ ] Both bulk buttons should now be **disabled** (no candidates).

### Section E — Search

- [ ] Switch filter to **All**. In the search box, type `cap`. Only the Structured Cap card remains.
- [ ] Type `P7-E2E-SOFT`. Only Soft Tee remains (search matches SKU).
- [ ] Clear the search. All 6 cards return.

### Section F — Customer-facing display (the gate works)

- [ ] Open `/store/phase-7-e2e-test-store` in a new tab (incognito or signed out, since the test store has `requireAuth=false`).
- [ ] **Approved products** (Structured Cap, plus anything you approved in steps B/D) display the **photorealistic render** image (the purple-tinted placeholder).
- [ ] **Unapproved products** (Soft Tee, anything still in Pending Review) display the **CSS logo overlay** composite — original product image with the logo positioned via the AI placement coordinates.
- [ ] **The customer never sees status badges.** No "Pending Review" or "Failed" indicators leak through. The gate is invisible to shoppers.

### Section G — Empty states

- [ ] Approve / re-render until **all** Pending Review cards clear. Filter on Pending Review: empty state shows "Nothing here · All renders for this store have been reviewed."
- [ ] Search for a non-existent SKU like `xyzqqq`. Empty state: "No matches · Try a different product name or SKU."

## Cleanup

```bash
DATABASE_URL=… npx tsx scripts/phase7-e2e-teardown.ts
```

Expected output: `removed: storeProducts: 6, stores: 1, products: 6, clients: 1, users: 1`.

## Known surface-area gaps (intentional, not bugs)

- The **Re-render queued** toast is fired from the orchestrator's `kind: "queued"` result, which still requires placement + logo + product image to all be present. The setup script populates all three — but if a re-render says "skipped: no_logo" or similar, that's the orchestrator working as designed, not a UI bug.
- If `mergetasks-render-worker` is running and `REDIS_URL` is configured, real re-render jobs **will** hit Gemini and consume API budget. Pause the worker (`pm2 stop mergetasks-render-worker`) before clicking Re-render if you want to avoid that cost during the walkthrough.
