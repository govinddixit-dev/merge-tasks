# Supplier Sync — SanMarCA Configuration Fix (Pending PSRESTful Access)

## Status: Blocked on paid PSRESTful API tier

## Background

PR #25 closed the original PSRESTful 422 errors on getProductPricing by 
adding required currency/fob_id/price_type query params. After deploy, 
logs showed many products being silently skipped with "No FOB points 
returned" warnings. This document captures the investigation that 
identified the real bug and the fix-pending-API-access.

## Real root cause

Single-row data error in suppliers table:
- suppliers.psRestfulCode is set to 'SanMar' (US endpoint)
- Our products are SanMar Canada / ATC styles (~13,855 SKUs, all 
  numeric IDs with -N variant suffix, Vancouver-shipped, CAD pricing)
- The correct PSRESTful endpoint code is 'SanMarCA'

## Verification (read-only API probes)

FOB endpoint:
- GET /v1.0.0/suppliers/SanMar/fob-points/23237-2 → "Data not found, 
  FobPointArray: null"
- GET /v1.0.0/suppliers/SanMarCA/fob-points/23237-2 → Valid: fobIds 
  1/2/4 (Vancouver/Mississauga/Calgary, all CAD)
- SanMarCA accepts both parent (23237) AND variant (23237-2) IDs 
  identically; variant-vs-parent is not the issue.

Pricing endpoint (BLOCKED):
- GET /v1.0.0/suppliers/SanMarCA/pricing-and-configuration/... → 
  "SanMarCA - All connection attempts failed"
- This is PSRESTful's upstream connectivity error, suggests our 
  trial-tier API access doesn't include pricing pass-through to 
  SanMarCA.
- Cannot apply the SQL fix until pricing endpoint is reachable, 
  because we'd just be replacing one silent-failure mode with another.

## Fix (when paid PSRESTful access is sorted)

1. Verify pricing endpoint works under SanMarCA:
   curl -s -u "$PS_USER:$PS_PASS" \
     "https://api.psrestful.com/v1.0.0/suppliers/SanMarCA/pricing-and-configuration/23237-2?currency=CAD&fob_id=1&price_type=Net"

2. If pricing returns valid data, apply single-row UPDATE:
   UPDATE suppliers SET psRestfulCode = 'SanMarCA' WHERE id = 1;

3. Trigger a small scoped sync to validate end-to-end before bulk run.

4. After bulk sync, masterProductPricing will populate for ~13,855 
   products for the first time (table currently has 0 sanmar rows).

## Files involved

- server/integrations/PSRestfulService.ts (getFobPoints + getProductPricing)
- server/integrations/supplierSyncEngine.ts (caller, FOB cache)
- suppliers table (the row to fix)

## Related

- PR #25 fixed the immediate 422 by adding required query params
- This document captures the next layer of the fix that's blocked on API access
