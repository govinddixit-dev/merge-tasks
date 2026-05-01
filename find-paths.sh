#!/bin/bash
cd /home/ubuntu/mergetasks
echo "=== Finding App.tsx ==="
find . -name "App.tsx" -type f 2>/dev/null
echo ""
echo "=== Finding CurationProductsTab.tsx ==="
find . -name "CurationProductsTab.tsx" -type f 2>/dev/null
echo ""
echo "=== Finding pages directory ==="
find . -type d -name "pages" 2>/dev/null | head -5
echo ""
echo "=== Finding components directory ==="
find . -type d -name "components" 2>/dev/null | head -5
echo ""
echo "=== Top level structure ==="
ls -la
echo ""
echo "=== Src structure ==="
ls -la src/ 2>/dev/null || ls -la client/ 2>/dev/null || echo "No src/ or client/"
