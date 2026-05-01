#!/bin/bash
# Diagnose the ProductDetail import issue
cd /home/ubuntu/mergetasks

echo "=========================================="
echo " DIAGNOSTIC: App.tsx import/route check"
echo "=========================================="

echo ""
echo "=== All ProductDetail references in App.tsx ==="
grep -n "ProductDetail" client/src/App.tsx || echo "NO MATCHES FOUND"

echo ""
echo "=== All import lines in App.tsx ==="
grep -n "^import " client/src/App.tsx

echo ""
echo "=== All Route lines in App.tsx ==="
grep -n "Route" client/src/App.tsx

echo ""
echo "=== Check if ProductDetail.tsx exists ==="
ls -la client/src/pages/ProductDetail.tsx 2>/dev/null || echo "FILE NOT FOUND"
ls -la client/src/pages/ProductDetail.tsx.bak 2>/dev/null || echo "NO BACKUP FOUND"

echo ""
echo "=== First 5 lines of ProductDetail.tsx ==="
head -5 client/src/pages/ProductDetail.tsx 2>/dev/null || echo "CANNOT READ FILE"

echo ""
echo "=== Check if ProductDetail has default export ==="
grep -n "export default" client/src/pages/ProductDetail.tsx 2>/dev/null || echo "NO DEFAULT EXPORT FOUND"

echo ""
echo "=== Full App.tsx (first 80 lines) ==="
head -80 client/src/App.tsx

echo ""
echo "=========================================="
echo " END DIAGNOSTIC"
echo "=========================================="
