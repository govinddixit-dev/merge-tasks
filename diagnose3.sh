#!/bin/bash
cd /home/ubuntu/mergetasks

echo "########## APP.TSX IMPORTS ##########"
head -30 client/src/App.tsx
echo ""
echo "########## PRODUCTDETAIL IN APP.TSX ##########"
grep -n "ProductDetail" client/src/App.tsx || echo "ZERO MATCHES"
echo ""
echo "########## CURATION ROUTES IN APP.TSX ##########"
grep -n "curation" client/src/App.tsx || echo "ZERO MATCHES"
echo ""
echo "########## APP LOADS OK? ##########"
curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:3000/
echo ""
echo ""
echo "########## CURATION PAGE LOADS? ##########"
curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:3000/curation
echo ""
echo ""
echo "########## PRODUCT DETAIL LOADS? ##########"
curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:3000/curation/product/63
echo ""
echo ""
echo "########## DONE ##########"
