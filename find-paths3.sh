#!/bin/bash
cd /home/ubuntu/mergetasks
echo "=== Curation.tsx ==="
find . -name "Curation.tsx" -path "*/client/*" -type f 2>/dev/null
echo ""
echo "=== client/src structure ==="
ls client/src/ 2>/dev/null
echo ""
echo "=== client/src/pages ==="
ls client/src/pages/ 2>/dev/null
echo ""
echo "=== client/src/components/curation ==="
ls client/src/components/curation/ 2>/dev/null
echo ""
echo "=== grep import from App.tsx for Curation ==="
grep -n "Curation" client/src/App.tsx 2>/dev/null
echo ""
echo "=== grep trpc import in any component ==="
grep -rn "from.*trpc" client/src/components/curation/CurationProductsTab.tsx 2>/dev/null || true
grep -rn "from.*trpc" client/src/pages/Curation.tsx 2>/dev/null || true
find . -path "*/pages/Curation.tsx" 2>/dev/null
