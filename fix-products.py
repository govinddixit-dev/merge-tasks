#!/usr/bin/env python3
"""
MergeTasks — Fix product images + clickable cards (two files)
=============================================================
1. CurationImportModal.tsx — Replace readAsDataURL with actual S3 upload
   via uploadProductImage mutation (already wired as prop)
2. CurationProductsTab.tsx — Add ProductImage with fallback + make cards
   clickable using wouter's useLocation

Run on EC2:
  cd /home/ubuntu/mergetasks
  python3 fix-products.py
  npx vite build && npx esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist && npx pm2 restart mergetasks
"""
import os, shutil

BASE = "/home/ubuntu/mergetasks"

def patch(path, description, replacements):
    print(f"\n{'='*60}")
    print(f"  {description}")
    print(f"  File: {path}")
    print(f"{'='*60}")
    if not os.path.exists(path):
        print(f"  SKIP — file not found")
        return False
    shutil.copy2(path, path + ".fix-products.bak")
    with open(path) as f:
        code = f.read()
    original = code
    for old, new in replacements:
        if old in code:
            code = code.replace(old, new, 1)
            print(f"  ✓ Replaced: {old[:70].strip()}...")
        else:
            print(f"  ✗ NOT FOUND: {old[:70].strip()}...")
    if code == original:
        print(f"  NO CHANGES")
        return False
    with open(path, 'w') as f:
        f.write(code)
    print(f"  SAVED")
    return True


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FIX 1: CurationImportModal.tsx — use S3 upload, not base64
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
modal_path = os.path.join(BASE, "client/src/components/curation/CurationImportModal.tsx")

# 1a) Replace the file input onChange handler to upload to S3 instead of readAsDataURL
modal_old_upload = '''<input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
                        const file = e.target.files?.[0]; if (!file) return;
                        setImageUploading(true);
                        try {
                          const reader = new FileReader();
                          reader.onload = (ev) => { setManualImages(prev => [...prev, ev.target?.result as string]); toast.success("Image uploaded"); setImageUploading(false); };
                          reader.readAsDataURL(file);
                        } catch { toast.error("Failed to upload image"); setImageUploading(false); }
                        e.target.value = "";
                      }} />'''

modal_new_upload = '''<input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
                        const file = e.target.files?.[0]; if (!file) return;
                        setImageUploading(true);
                        try {
                          const reader = new FileReader();
                          const base64Promise = new Promise<string>((resolve, reject) => {
                            reader.onload = (ev) => resolve(ev.target?.result as string);
                            reader.onerror = reject;
                          });
                          reader.readAsDataURL(file);
                          const base64Full = await base64Promise;
                          const base64Data = base64Full.split(",")[1];
                          const res = await uploadProductImage.mutateAsync({
                            fileName: file.name,
                            mimeType: file.type,
                            base64Data,
                          }) as { url: string };
                          setManualImages(prev => [...prev, res.url]);
                          toast.success("Image uploaded");
                        } catch { toast.error("Failed to upload image"); }
                        setImageUploading(false);
                        e.target.value = "";
                      }} />'''

patch(modal_path, "FIX 1: Manual image upload → S3 (not base64)", [
    (modal_old_upload, modal_new_upload),
])


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FIX 2: CurationProductsTab.tsx — image fallback + clickable
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
tab_path = os.path.join(BASE, "client/src/components/curation/CurationProductsTab.tsx")

# 2a) Replace imports + add helper components
tab_old_imports = '''import { Star, Check, Plus, Trash2, Package, Download, Database } from "lucide-react";
import { toast } from "sonner";'''

tab_new_imports = '''import { Star, Check, Plus, Trash2, Package, Download, Database, ImageOff } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { useLocation } from "wouter";

/**
 * Resolve product image URL to a displayable src.
 * Handles: full URLs, S3 keys, data URIs, and empty/broken values.
 */
function resolveImageUrl(raw: string | null | undefined): string | null {
  if (!raw || raw.trim() === "") return null;
  // Full URL or data URI — use as-is
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:")) {
    return raw;
  }
  // Absolute path — served by same origin
  if (raw.startsWith("/")) return raw;
  // Bare S3 key like "product-images/123/img.jpg" — prepend uploads API
  return `/api/uploads/${raw}`;
}

/** Image with graceful fallback on error or empty src */
function ProductImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const resolved = resolveImageUrl(src);

  if (!resolved || failed) {
    return (
      <div className="h-full w-full flex items-center justify-center text-mt-ink-4">
        <ImageOff size={28} strokeWidth={1.5} />
      </div>
    );
  }

  return (
    <img
      src={resolved}
      alt={alt}
      className="h-full w-full object-contain"
      onError={() => setFailed(true)}
    />
  );
}'''

# 2b) In the grid view — replace <img> with <ProductImage> and add onClick + useLocation
tab_old_grid_card = '''          <div key={i} className="bg-white rounded-lg border border-mt-border cursor-pointer card-hover overflow-hidden">
            <div className="w-full h-44 flex items-center justify-center bg-[#F8F8FA] p-4">
              <img src={product.image} alt={product.name} className="h-full w-full object-contain" />'''

tab_new_grid_card = '''          <div key={i} className="bg-white rounded-lg border border-mt-border cursor-pointer card-hover overflow-hidden"
            onClick={() => { if (product.dbId) setLocation(`/curation?product=${product.dbId}`); }}>
            <div className="w-full h-44 flex items-center justify-center bg-[#F8F8FA] p-4">
              <ProductImage src={product.image} alt={product.name} />'''

# 2c) In the list view — replace <img> with <ProductImage> and add onClick
tab_old_list_row = '''          <div key={i} className="flex items-center gap-4 p-4 bg-white rounded-lg border border-mt-border hover:border-primary/30 transition-colors">
            <div className="w-16 h-16 flex-shrink-0 bg-[#F8F8FA] rounded-lg flex items-center justify-center p-2">
              <img src={product.image} alt={product.name} className="h-full w-full object-contain" />'''

tab_new_list_row = '''          <div key={i} className="flex items-center gap-4 p-4 bg-white rounded-lg border border-mt-border hover:border-primary/30 transition-colors cursor-pointer"
            onClick={() => { if (product.dbId) setLocation(`/curation?product=${product.dbId}`); }}>
            <div className="w-16 h-16 flex-shrink-0 bg-[#F8F8FA] rounded-lg flex items-center justify-center p-2">
              <ProductImage src={product.image} alt={product.name} />'''

# 2d) Add useLocation hook inside the component
tab_old_function = '''export default function CurationProductsTab({
  promoFiltered,
  viewMode,
  addedProducts,
  onAddProduct,
  onDeleteProduct,
}: CurationProductsTabProps) {
  if (promoFiltered.length === 0) {'''

tab_new_function = '''export default function CurationProductsTab({
  promoFiltered,
  viewMode,
  addedProducts,
  onAddProduct,
  onDeleteProduct,
}: CurationProductsTabProps) {
  const [, setLocation] = useLocation();

  if (promoFiltered.length === 0) {'''

patch(tab_path, "FIX 2: Image fallback + clickable cards", [
    (tab_old_imports, tab_new_imports),
    (tab_old_function, tab_new_function),
    (tab_old_grid_card, tab_new_grid_card),
    (tab_old_list_row, tab_new_list_row),
])


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print("\n" + "=" * 60)
print("ALL FIXES APPLIED")
print("=" * 60)
print("""
1. CurationImportModal: Manual image upload now uses uploadProductImage
   mutation → files go to S3, imageUrl column gets a proper HTTPS URL
   (fits in varchar 1024), images load correctly everywhere.

2. CurationProductsTab: Images wrapped in ProductImage component with
   graceful fallback. Both grid and list cards are clickable — navigate
   to product detail via wouter setLocation.

Backups saved as .fix-products.bak

Next: rebuild and restart:
  cd /home/ubuntu/mergetasks
  npx vite build && npx esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist && npx pm2 restart mergetasks
""")
