#!/bin/bash
set -e

###############################################################################
# update-product-image.sh
# Updates the Nike Polo Shirt imageUrl in the database to point to S3/CDN
# This is a DATA update, not a code change — nothing hardcoded in the codebase
###############################################################################

echo "=========================================="
echo " MergeTasks — Update Product Image URL"
echo "=========================================="

# Database credentials (same as in server/.env)
DB_HOST="mergetasks-production.cqpyyace2qyr.us-east-1.rds.amazonaws.com"
DB_USER="mtadmin"
DB_PASS="MergeTasksDB2026"
DB_NAME="mergetasks"

CDN_URL="https://d2xsxph8kpxf.cloudfront.net/products/nike-polo-shirt.jpg"

echo ""
echo "[1/3] Checking current product records..."
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e \
  "SELECT id, name, imageUrl FROM products WHERE name LIKE '%Nike%' OR name LIKE '%Polo%';"

echo ""
echo "[2/3] Updating imageUrl for Nike Polo Shirt..."
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e \
  "UPDATE products SET imageUrl = '$CDN_URL' WHERE name LIKE '%Nike Polo%';"

echo ""
echo "[3/3] Verifying update..."
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e \
  "SELECT id, name, imageUrl FROM products WHERE name LIKE '%Nike%' OR name LIKE '%Polo%';"

echo ""
echo "✅ Done! Reload app.mergetasks.com/curation to see the image."
echo "=========================================="
