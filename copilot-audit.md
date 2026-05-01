# Copilot Audit — Current State

## Current Architecture
- Backend: `server/routers/copilot.ts` — single `chat` mutation + `quickAction` mutation
- Frontend 1: `client/src/pages/Dashboard.tsx` — inline chat UI with `trpc.copilot.chat.useMutation()`
- Frontend 2: `client/src/components/GlobalAIAssistant.tsx` — floating chat panel, same mutation

## Current Tool Definitions (2 tools)
1. `create_proposal` — Creates a bare proposal record with text notes (no real products from catalog)
2. `navigate_to_page` — Client-side navigation

## Problems
1. `create_proposal` only inserts a proposal row with suggested products in notes text — does NOT add real proposalProducts records
2. No product catalog matching — LLM invents product names/prices instead of using actual catalog
3. No `send_proposal` tool — can't send the email
4. No `add_products_to_proposal` tool — can't add real products
5. No `search_products` tool — can't look up the catalog
6. No `search_clients` tool — fuzzy match is primitive
7. Frontend doesn't show action progress (creating... adding products... sending...)
8. Dashboard has simulated fallback responses that mask failures
9. No multi-step execution — can't chain create → add products → send

## Required Tools for Full Execution
1. `search_clients` — Find clients by name/industry
2. `search_products` — Search product catalog by name/category/keyword
3. `create_proposal` — Create proposal with real product IDs from catalog
4. `send_proposal` — Send the proposal email to the client POC
5. `navigate_to_page` — Keep existing

## Execution Flow for "Build a full proposal for Acme Corp with 50 hoodies and send it"
1. LLM calls search_clients("Acme Corp") → gets client ID + contact email
2. LLM calls search_products("hoodies") → gets product IDs + prices
3. LLM calls create_proposal(clientId, title, products: [{productId, qty: 50, unitPrice}])
4. LLM calls send_proposal(proposalId, origin) → sends email
5. LLM responds with summary of what it did

## Frontend Changes Needed
- Show action cards/progress indicators for each tool execution step
- Remove simulated fallback responses
- Add toast notifications for completed actions
- Navigate to proposal after creation
