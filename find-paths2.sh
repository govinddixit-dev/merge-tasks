#!/bin/bash
cd /home/ubuntu/mergetasks
echo "=== App.tsx ==="
find . -name "App.tsx" -type f 2>/dev/null
echo ""
echo "=== CurationProductsTab.tsx ==="
find . -name "CurationProductsTab.tsx" -type f 2>/dev/null
echo ""
echo "=== src/pages contents ==="
ls src/pages/ 2>/dev/null | head -20
echo ""
echo "=== src/components contents ==="
ls src/components/ 2>/dev/null | head -10
echo ""
echo "=== trpc import ==="
find . -name "trpc.ts" -o -name "trpc.tsx" 2>/dev/null | grep -v node_modules
