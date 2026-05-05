#!/bin/bash
cd /home/ubuntu/mergetasks

echo "=== IMPORTS (first 30 lines of App.tsx) ==="
head -30 client/src/App.tsx

echo ""
echo "=== ALL ProductDetail references ==="
grep -n "ProductDetail" client/src/App.tsx || echo "NONE FOUND"

echo ""
echo "=== ALL curation routes ==="
grep -n "curation" client/src/App.tsx || echo "NONE FOUND"

echo ""
echo "=== ProductDetail.tsx export line ==="
grep -n "export default" client/src/pages/ProductDetail.tsx 2>/dev/null || echo "NO EXPORT"

echo ""
echo "=== ProductDetail.tsx first 10 lines ==="
head -10 client/src/pages/ProductDetail.tsx 2>/dev/null || echo "FILE MISSING"

echo ""
echo "=== PM2 error log (last 20 lines) ==="
npx pm2 logs mergetasks --lines 20 --nostream 2>&1 | tail -25
