#!/bin/bash
set -e

###############################################################################
# fix-product-detail.sh
# Fixes: ReferenceError: ProductDetail is not defined
# Root cause: The import line for ProductDetail was never added to App.tsx
# Fix: Add the missing import after the PublicProductDetail import (line 33)
#
# REGRESSION CHECK:
# ✓ Only adds 1 import line — zero other changes
# ✓ All existing imports preserved
# ✓ All existing routes preserved
# ✓ ProductDetail.tsx already exists and has default export
###############################################################################

echo "==========================================="
echo " MergeTasks — Fix ProductDetail Import"
echo "==========================================="

cd /home/ubuntu/mergetasks

# Verify the component file exists
if [ ! -f client/src/pages/ProductDetail.tsx ]; then
  echo "ERROR: ProductDetail.tsx not found!"
  exit 1
fi

# Verify it has a default export
if ! grep -q "export default" client/src/pages/ProductDetail.tsx; then
  echo "ERROR: ProductDetail.tsx has no default export!"
  exit 1
fi

echo "[1/3] Checking current state..."

# Check if import already exists
if grep -q '^import ProductDetail from' client/src/App.tsx; then
  echo "   ✓ Import already exists — nothing to do"
else
  echo "   → Import missing — adding it now"
  
  # Add import after the PublicProductDetail import (line 33)
  sed -i '/^import PublicProductDetail from "\.\/pages\/PublicProductDetail";$/a import ProductDetail from "./pages/ProductDetail";' client/src/App.tsx
  
  # Verify it was added
  if grep -q '^import ProductDetail from' client/src/App.tsx; then
    echo "   ✓ Import added successfully"
  else
    echo "   → sed pattern didn't match, trying alternate approach..."
    # Fallback: insert at a specific line number (after line 33)
    sed -i '33a import ProductDetail from "./pages/ProductDetail";' client/src/App.tsx
    
    if grep -q '^import ProductDetail from' client/src/App.tsx; then
      echo "   ✓ Import added (fallback method)"
    else
      echo "   ERROR: Could not add import!"
      exit 1
    fi
  fi
fi

echo ""
echo "[2/3] Verifying App.tsx state..."
echo "   Imports with 'ProductDetail':"
grep -n "ProductDetail" client/src/App.tsx
echo ""
echo "   Route for /curation/product/:id:"
grep -n "curation/product" client/src/App.tsx

echo ""
echo "[3/3] Building & restarting..."
npx vite build 2>&1 | tail -5
npx esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist 2>&1 | tail -3
npx pm2 restart mergetasks

echo ""
echo "==========================================="
echo " ✅ Fix applied — ProductDetail import added"
echo ""
echo "  Test: Go to app.mergetasks.com/curation"
echo "  Click any product card → should open detail page"
echo "==========================================="
