#!/bin/bash
set -e

###############################################################################
# fix-image-url.sh
# Fixes the Nike Polo Shirt imageUrl to use the public S3 URL (CloudFront
# domain was incorrect). This is a data-only fix.
###############################################################################

echo "=========================================="
echo " MergeTasks — Fix Product Image URL"
echo "=========================================="

DB_HOST="mergetasks-production.cqpyyace2qyr.us-east-1.rds.amazonaws.com"
DB_USER="mtadmin"
DB_PASS="MergeTasksDB2026"
DB_NAME="mergetasks"

# Direct S3 public URL (verified accessible — HTTP 200)
S3_URL="https://mergetasks-uploads-production.s3.us-east-1.amazonaws.com/products/nike-polo-shirt.jpg"

echo ""
echo "[1/2] Updating imageUrl to public S3 URL..."
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e \
  "UPDATE products SET imageUrl = '$S3_URL' WHERE id = 63;"

echo ""
echo "[2/2] Verifying..."
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e \
  "SELECT id, name, imageUrl FROM products WHERE id = 63;"

echo ""
echo "Done! Restart app and reload curation page:"
echo "  cd ~/mergetasks && npx pm2 restart mergetasks"
echo "=========================================="
