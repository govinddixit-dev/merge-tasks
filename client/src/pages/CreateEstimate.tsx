/**
 * CreateEstimate — Unified Canvas estimate builder.
 *
 * Departure from the invoice builder: this page uses react-hook-form + zod
 * instead of raw useState. That choice was explicit — the line-item engine,
 * package grouping, and per-field validation are easier to reason about
 * with a form library, and the user's spec called for rhf + zod directly.
 *
 * Dual-write boundary: saves go through
 * trpc.estimatesInvoices.estimates.builderSave, which writes exclusively to
 * the relational estimatePackages / estimateLineItems tables and NULLs the
 * legacy JSON estimates.lineItems column. The detail page (EstimateDetail)
 * continues to read the JSON column for legacy proposal-derived estimates;
 * it will get a dual-read upgrade when that flow is migrated.
 *
 * URL routing
 *   /estimates/new            → fresh builder, no draft id yet
 *   /estimates/new?draft=42   → edits draft #42 in place
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus, Trash2, ChevronUp, ChevronDown, Package as PackageIcon,
  X as XIcon, ArrowLeft, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

// ── Formatting ──────────────────────────────────────────────────────────────
// CAD-locale currency per spec. Never concat a dollar sign manually.
const cadFormatter = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});
const fmtCAD = (n: number) => cadFormatter.format(Number.isFinite(n) ? n : 0);

// Stable per-row keys so react-hook-form's field-array ids stay sane across
// re-orders and the "reference a new package before save" contract works.
const clientKey = () => `k_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;

// ── Schema ─────────────────────────────────────────────────────────────────
const packageFormSchema = z.object({
  id: z.number().optional(),
  clientKey: z.string(),
  name: z.string().min(1, "Package name required").max(255),
  sortOrder: z.number().int(),
});

const lineItemFormSchema = z.object({
  id: z.number().optional(),
  clientKey: z.string(),
  packageClientKey: z.string().nullable(),
  productId: z.number().nullable(),
  productSku: z.string().nullable(),
  description: z.string().min(1, "Description required"),
  quantity: z.number().min(0, "Must be ≥ 0"),
  unitPrice: z.number().min(0, "Must be ≥ 0"),
  sortOrder: z.number().int(),
});

const formSchema = z.object({
  clientId: z.number().nullable(),
  notes: z.string(),
  terms: z.string(),
  validUntil: z.string(),
  packages: z.array(packageFormSchema),
  lineItems: z.array(lineItemFormSchema),
});

type PackageForm = z.infer<typeof packageFormSchema>;
type LineItemForm = z.infer<typeof lineItemFormSchema>;
type FormValues = z.infer<typeof formSchema>;

// ── Animation presets ──────────────────────────────────────────────────────
const CUBIC: [number, number, number, number] = [0.4, 0, 0.2, 1];
const LINE_MOTION = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: 6 },
  transition: { duration: 0.18, ease: CUBIC },
} as const;
const TAP = { scale: 0.98 } as const;

// ── Catalog product shape — trimmed to what the autocomplete needs ────────
type CatalogProduct = {
  id: number;
  name: string;
  sku: string | null;
  basePrice: string | null;
};

// ────────────────────────────────────────────────────────────────────────────
// CLIENT PICKER — inline search popover. Custom rather than pulling in a
// Combobox primitive because the codebase doesn't have one and CreateInvoice
// set the pattern.
// ────────────────────────────────────────────────────────────────────────────
function ClientPicker({
  value, onChange, disabled,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(search.trim()), 200);
    return () => clearTimeout(h);
  }, [search]);

  const { data: page, isLoading } = trpc.clients.list.useQuery(
    { search: debounced || undefined, limit: 20 },
    { placeholderData: (prev) => prev },
  );
  const items = (page && "items" in page ? page.items : []) ?? [];

  const { data: selected } = trpc.clients.getById.useQuery(
    { id: value ?? 0 },
    { enabled: value != null && value > 0 },
  );

  if (value != null && selected) {
    return (
      <div className="flex items-center gap-3 rounded-md bg-mt-surface px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-mt-ink">{selected.companyName}</div>
          {selected.contactName ? (
            <div className="text-sm text-mt-ink-3">
              {selected.contactName}{selected.contactEmail ? ` · ${selected.contactEmail}` : ""}
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label="Change client"
        >
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search clients by company, contact, or email…"
        disabled={disabled}
        aria-label="Search clients"
      />
      {open ? (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-mt-border bg-white shadow-lg">
          {isLoading ? (
            <div className="p-3"><Skeleton className="h-6 w-full" /></div>
          ) : items.length === 0 ? (
            <div className="p-3 text-sm text-mt-ink-3">No clients found.</div>
          ) : (
            <ul className="max-h-64 overflow-auto py-1">
              {items.slice(0, 12).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); onChange(c.id); setOpen(false); setSearch(""); }}
                    className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-mt-surface-2"
                  >
                    <span className="font-medium text-mt-ink">{c.companyName}</span>
                    {c.contactEmail ? (
                      <span className="text-xs text-mt-ink-3">{c.contactEmail}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// PRODUCT AUTOCOMPLETE — inline per-row search. Picking a product fills
// description + unitPrice (three-state line item: A linked-with-defaults).
// Subsequent edits stay on the row (state B). Unlinking clears productId
// but keeps the edited description/price (state C).
// ────────────────────────────────────────────────────────────────────────────
function ProductAutocomplete({
  catalog,
  onPick,
  disabled,
}: {
  catalog: CatalogProduct[];
  onPick: (p: CatalogProduct) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return catalog.slice(0, 8);
    return catalog.filter((p) =>
      p.name.toLowerCase().includes(needle)
      || (p.sku ?? "").toLowerCase().includes(needle),
    ).slice(0, 8);
  }, [q, catalog]);

  return (
    <div className="relative">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Link a product…"
        disabled={disabled}
        aria-label="Link line item to a catalog product"
        className="h-8 text-sm"
      />
      {open && matches.length > 0 ? (
        <div className="absolute z-20 mt-1 w-72 rounded-md border border-mt-border bg-white shadow-lg">
          <ul className="max-h-64 overflow-auto py-1">
            {matches.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(p);
                    setOpen(false);
                    setQ("");
                  }}
                  className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left hover:bg-mt-surface-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-mt-ink">{p.name}</span>
                    {p.sku ? <span className="truncate text-xs text-mt-ink-3">SKU {p.sku}</span> : null}
                  </span>
                  {p.basePrice != null ? (
                    <span className="text-xs tabular-nums text-mt-ink-3">
                      {fmtCAD(parseFloat(p.basePrice))}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// LINE ITEM ROW
// ────────────────────────────────────────────────────────────────────────────
type LineItemRowProps = {
  form: ReturnType<typeof useForm<FormValues>>;
  fieldIndex: number;
  catalog: CatalogProduct[];
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
};
function LineItemRow({
  form, fieldIndex, catalog,
  onRemove, onMoveUp, onMoveDown, canMoveUp, canMoveDown,
}: LineItemRowProps) {
  const { control, register, setValue, watch, formState: { errors } } = form;
  const li = watch(`lineItems.${fieldIndex}`);
  const lineError = errors.lineItems?.[fieldIndex];
  const lineTotal = (li?.quantity ?? 0) * (li?.unitPrice ?? 0);

  return (
    <motion.li layout {...LINE_MOTION}
      className="group grid grid-cols-[auto_1fr_7rem_8rem_7rem_auto] items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-gray-50/50"
    >
      {/* Reorder buttons — keyboard-native, no drag library required */}
      <div className="flex flex-col gap-0.5">
        <motion.button
          type="button" whileTap={TAP}
          onClick={onMoveUp} disabled={!canMoveUp}
          className="flex h-5 w-5 items-center justify-center rounded text-mt-ink-3 hover:bg-mt-surface-2 hover:text-mt-ink disabled:opacity-30"
          aria-label="Move line item up"
        >
          <ChevronUp size={14} />
        </motion.button>
        <motion.button
          type="button" whileTap={TAP}
          onClick={onMoveDown} disabled={!canMoveDown}
          className="flex h-5 w-5 items-center justify-center rounded text-mt-ink-3 hover:bg-mt-surface-2 hover:text-mt-ink disabled:opacity-30"
          aria-label="Move line item down"
        >
          <ChevronDown size={14} />
        </motion.button>
      </div>

      {/* Description + (optional) product link chip */}
      <div className="flex min-w-0 flex-col gap-1">
        <Controller
          control={control}
          name={`lineItems.${fieldIndex}.description`}
          render={({ field }) => (
            <Textarea
              {...field}
              rows={1}
              placeholder="Line item description"
              className="min-h-9 py-1.5 text-sm"
              aria-label="Line item description"
              aria-invalid={!!lineError?.description}
            />
          )}
        />
        {lineError?.description ? (
          <p className="text-xs text-red-600">{lineError.description.message}</p>
        ) : null}

        {li?.productId != null ? (
          <div className="flex items-center gap-1.5 text-xs text-mt-ink-3">
            <span className="inline-flex items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
              {li.productSku ? `SKU ${li.productSku}` : "Linked"}
            </span>
            <button
              type="button"
              onClick={() => {
                setValue(`lineItems.${fieldIndex}.productId`, null, { shouldDirty: true });
                setValue(`lineItems.${fieldIndex}.productSku`, null, { shouldDirty: true });
              }}
              className="rounded p-0.5 text-mt-ink-3 hover:bg-mt-surface-2 hover:text-mt-ink"
              aria-label="Unlink product"
            >
              <XIcon size={12} />
            </button>
          </div>
        ) : (
          <ProductAutocomplete
            catalog={catalog}
            onPick={(p) => {
              setValue(`lineItems.${fieldIndex}.productId`, p.id, { shouldDirty: true });
              setValue(`lineItems.${fieldIndex}.productSku`, p.sku, { shouldDirty: true });
              // Only auto-fill empty fields — respect existing user input.
              if (!li?.description) setValue(`lineItems.${fieldIndex}.description`, p.name, { shouldDirty: true });
              if (!li?.unitPrice && p.basePrice != null) {
                setValue(`lineItems.${fieldIndex}.unitPrice`, parseFloat(p.basePrice), { shouldDirty: true });
              }
            }}
          />
        )}
      </div>

      {/* Quantity */}
      <div className="flex flex-col gap-1">
        <Input
          type="number" inputMode="decimal" step="0.001" min={0}
          className="h-9 text-right text-sm tabular-nums"
          aria-label="Quantity"
          aria-invalid={!!lineError?.quantity}
          {...register(`lineItems.${fieldIndex}.quantity`, { valueAsNumber: true })}
        />
        {lineError?.quantity ? (
          <p className="text-xs text-red-600">{lineError.quantity.message}</p>
        ) : null}
      </div>

      {/* Unit price */}
      <div className="flex flex-col gap-1">
        <Input
          type="number" inputMode="decimal" step="0.01" min={0}
          className="h-9 text-right text-sm tabular-nums"
          aria-label="Unit price"
          aria-invalid={!!lineError?.unitPrice}
          {...register(`lineItems.${fieldIndex}.unitPrice`, { valueAsNumber: true })}
        />
        {lineError?.unitPrice ? (
          <p className="text-xs text-red-600">{lineError.unitPrice.message}</p>
        ) : null}
      </div>

      {/* Line total (read-only) */}
      <div className="flex h-9 items-center justify-end text-sm font-medium tabular-nums text-mt-ink">
        {fmtCAD(lineTotal)}
      </div>

      {/* Delete */}
      <motion.button
        type="button" whileTap={TAP}
        onClick={onRemove}
        className="flex h-9 w-9 items-center justify-center rounded text-mt-ink-3 hover:bg-red-50 hover:text-red-600"
        aria-label="Remove line item"
      >
        <Trash2 size={16} />
      </motion.button>
    </motion.li>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ────────────────────────────────────────────────────────────────────────────
export default function CreateEstimate() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const utils = trpc.useUtils();

  // URL is source of truth for which draft we're editing.
  const initialDraftId = useMemo(() => {
    const p = new URLSearchParams(searchString);
    const raw = p.get("draft");
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchString]);
  const [draftId, setDraftId] = useState<number | null>(initialDraftId);

  // One catalog pull, in-memory filter per keystroke — matches CreateInvoice.
  const { data: catalogPage } = trpc.products.list.useQuery(
    { limit: 200 },
    { staleTime: 60 * 1000 },
  );
  const catalog = useMemo<CatalogProduct[]>(
    () => (catalogPage?.items ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku ?? null,
      basePrice: p.basePrice ?? null,
    })),
    [catalogPage],
  );

  // ── Form ───────────────────────────────────────────────────────────────
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      clientId: null,
      notes: "",
      terms: "",
      validUntil: "",
      packages: [],
      lineItems: [],
    },
    mode: "onBlur",
  });
  const { control, register, handleSubmit, reset, watch, setValue, getValues, formState: { errors } } = form;
  const packagesField = useFieldArray({ control, name: "packages", keyName: "_fk" });
  const lineItemsField = useFieldArray({ control, name: "lineItems", keyName: "_fk" });

  // ── Draft hydration ────────────────────────────────────────────────────
  const { data: draftData } = trpc.estimatesInvoices.estimates.builderGet.useQuery(
    { id: draftId ?? 0 },
    { enabled: draftId != null && draftId > 0 },
  );
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!draftData || hydrated) return;
    // Build a package-id → clientKey map so line items reference the same
    // key the package row carries; clientKey stays stable through edits.
    const pkgKeyMap = new Map<number, string>();
    const packages: PackageForm[] = draftData.packages.map((p) => {
      const key = clientKey();
      pkgKeyMap.set(p.id, key);
      return { id: p.id, clientKey: key, name: p.name, sortOrder: p.sortOrder };
    });
    const lineItems: LineItemForm[] = draftData.lineItems.map((li) => ({
      id: li.id,
      clientKey: clientKey(),
      packageClientKey: li.packageId != null ? pkgKeyMap.get(li.packageId) ?? null : null,
      productId: li.productId,
      productSku: null, // hydrate from catalog if needed; server doesn't carry SKU
      description: li.description,
      quantity: parseFloat(li.quantity),
      unitPrice: parseFloat(li.unitPrice),
      sortOrder: li.sortOrder,
    }));
    reset({
      clientId: draftData.estimate.clientId,
      notes: draftData.estimate.notes ?? "",
      terms: draftData.estimate.terms ?? "",
      validUntil: draftData.estimate.validUntil
        ? new Date(draftData.estimate.validUntil).toISOString().slice(0, 10)
        : "",
      packages,
      lineItems,
    });
    setHydrated(true);
  }, [draftData, hydrated, reset]);

  // Once the catalog arrives, populate missing productSku on hydrated rows
  // so the linked-product chip renders its SKU without a refetch.
  useEffect(() => {
    if (!hydrated || catalog.length === 0) return;
    const current = getValues("lineItems");
    let changed = false;
    const next = current.map((li) => {
      if (li.productId != null && li.productSku == null) {
        const match = catalog.find((p) => p.id === li.productId);
        if (match) { changed = true; return { ...li, productSku: match.sku }; }
      }
      return li;
    });
    if (changed) setValue("lineItems", next, { shouldDirty: false });
  }, [catalog, hydrated, getValues, setValue]);

  // ── Derived totals ─────────────────────────────────────────────────────
  const lineItemsWatch = watch("lineItems");
  const subtotal = useMemo(
    () => (lineItemsWatch ?? []).reduce(
      (s, li) => s + (Number.isFinite(li.quantity) ? li.quantity : 0) * (Number.isFinite(li.unitPrice) ? li.unitPrice : 0),
      0,
    ),
    [lineItemsWatch],
  );
  // Tax/shipping aren't editable in the builder v1 — header preserves the
  // estimate row's existing values. Display only.
  const total = subtotal;

  // ── Autosave ──────────────────────────────────────────────────────────
  const saveMutation = trpc.estimatesInvoices.estimates.builderSave.useMutation({
    onSuccess: (res) => {
      if (draftId == null) {
        setDraftId(res.estimate.id);
        // Preserve the draft id in the URL so a refresh keeps editing the same row.
        const url = new URL(window.location.href);
        url.searchParams.set("draft", String(res.estimate.id));
        window.history.replaceState(null, "", url.toString());
      }
      // Reconcile server-assigned ids back into the form so the next save
      // UPDATEs instead of re-INSERTs.
      const current = getValues();
      const pkgIdByKey = new Map<string, number>();
      const lineIdByKey = new Map<string, number>();
      current.packages.forEach((p, idx) => {
        const serverPkg = res.packages[idx];
        if (serverPkg) pkgIdByKey.set(p.clientKey, serverPkg.id);
      });
      current.lineItems.forEach((li, idx) => {
        const serverLi = res.lineItems[idx];
        if (serverLi) lineIdByKey.set(li.clientKey, serverLi.id);
      });
      setValue(
        "packages",
        current.packages.map((p) => ({ ...p, id: p.id ?? pkgIdByKey.get(p.clientKey) })),
        { shouldDirty: false },
      );
      setValue(
        "lineItems",
        current.lineItems.map((li) => ({ ...li, id: li.id ?? lineIdByKey.get(li.clientKey) })),
        { shouldDirty: false },
      );
      setSaveState("saved");
      void utils.estimatesInvoices.estimates.list.invalidate();
    },
    onError: () => {
      setSaveState("error");
    },
  });
  type SaveState = "idle" | "saving" | "saved" | "error";
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const latestWatch = watch();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHydratingRef = useRef(false);

  // Persist debounced-500ms after the last field change. Skip while the
  // form is hydrating to avoid a save-on-reset loop.
  useEffect(() => {
    if (!hydrated && draftId != null) return;
    if (isHydratingRef.current) return;
    if (latestWatch.clientId == null) return; // need a client before we can save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const values = getValues();
      const valid = formSchema.safeParse(values);
      if (!valid.success) return; // inline errors will already be showing
      setSaveState("saving");
      // sortOrder is derived from array position at save time — the
      // useFieldArray.swap helper reorders rows but doesn't rewrite the
      // sortOrder field, so the form value can drift. Using the index is
      // authoritative and keeps read-back ordering stable.
      saveMutation.mutate({
        id: draftId ?? undefined,
        clientId: values.clientId,
        notes: values.notes,
        terms: values.terms,
        validUntil: values.validUntil ? new Date(values.validUntil + "T00:00:00Z").toISOString() : null,
        packages: values.packages.map((p, idx) => ({
          id: p.id,
          clientPackageKey: p.clientKey,
          name: p.name,
          sortOrder: idx,
        })),
        lineItems: values.lineItems.map((li, idx) => ({
          id: li.id,
          packageId: null, // resolved server-side via clientPackageKey below
          clientPackageKey: li.packageClientKey,
          productId: li.productId,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          sortOrder: idx,
        })),
      });
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(latestWatch)]);

  // ── Line-item helpers ─────────────────────────────────────────────────
  const addItem = useCallback((packageClientKey: string | null) => {
    lineItemsField.append({
      clientKey: clientKey(),
      packageClientKey,
      productId: null,
      productSku: null,
      description: "",
      quantity: 1,
      unitPrice: 0,
      sortOrder: lineItemsField.fields.length,
    });
  }, [lineItemsField]);

  const addPackage = useCallback(() => {
    packagesField.append({
      clientKey: clientKey(),
      name: `Package ${packagesField.fields.length + 1}`,
      sortOrder: packagesField.fields.length,
    });
  }, [packagesField]);

  // Reorder a line item within its own scope (same packageClientKey) —
  // index swap via rhf's useFieldArray.swap. Cross-scope moves use the
  // package dropdown on the row itself (not implemented v1 — keyboard
  // reorder covers the core workflow per spec).
  const moveItem = useCallback((index: number, dir: -1 | 1) => {
    const items = getValues("lineItems");
    const scope = items[index].packageClientKey;
    const scopeIndexes = items
      .map((li, i) => ({ li, i }))
      .filter((x) => x.li.packageClientKey === scope)
      .map((x) => x.i);
    const posInScope = scopeIndexes.indexOf(index);
    const newPosInScope = posInScope + dir;
    if (newPosInScope < 0 || newPosInScope >= scopeIndexes.length) return;
    lineItemsField.swap(index, scopeIndexes[newPosInScope]);
  }, [getValues, lineItemsField]);

  // ── Group line items by package for rendering ─────────────────────────
  const groupedFields = useMemo(() => {
    const byPkg = new Map<string, number[]>(); // packageClientKey → [indexes]
    const ungrouped: number[] = [];
    lineItemsField.fields.forEach((_, idx) => {
      const key = (getValues(`lineItems.${idx}.packageClientKey`) as string | null) ?? null;
      if (key == null) ungrouped.push(idx);
      else {
        if (!byPkg.has(key)) byPkg.set(key, []);
        byPkg.get(key)!.push(idx);
      }
    });
    return { byPkg, ungrouped };
  }, [lineItemsField.fields, getValues, lineItemsWatch]);

  // ── Generate Preview ───────────────────────────────────────────────────
  // Save-and-navigate: bypass the debounce timer, force an immediate save
  // with the current form values, then hand off to EstimateDetail which is
  // the canonical preview surface (Download PDF, Send to Client, Convert to
  // Invoice all live there). If the save fails, surface the error and stay
  // put so the distributor can fix the inputs.
  const [previewSubmitting, setPreviewSubmitting] = useState(false);
  const onGeneratePreview = handleSubmit(async (values) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setPreviewSubmitting(true);
    setSaveState("saving");
    try {
      const res = await saveMutation.mutateAsync({
        id: draftId ?? undefined,
        clientId: values.clientId,
        notes: values.notes,
        terms: values.terms,
        validUntil: values.validUntil ? new Date(values.validUntil + "T00:00:00Z").toISOString() : null,
        packages: values.packages.map((p, idx) => ({
          id: p.id,
          clientPackageKey: p.clientKey,
          name: p.name,
          sortOrder: idx,
        })),
        lineItems: values.lineItems.map((li, idx) => ({
          id: li.id,
          packageId: null,
          clientPackageKey: li.packageClientKey,
          productId: li.productId,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          sortOrder: idx,
        })),
      });
      navigate(`/estimates/${res.estimate.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the estimate — please try again");
    } finally {
      setPreviewSubmitting(false);
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* Pinned header — estimate number left, live total right in primary.
          Mobile: number collapses, only total shows. */}
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <Button
              type="button" variant="ghost" size="sm"
              onClick={() => navigate("/documents/estimates")}
              aria-label="Back to estimates list"
            >
              <ArrowLeft size={16} />
              <span className="hidden sm:inline">Estimates</span>
            </Button>
            <span className="hidden font-mono text-sm text-mt-ink-3 md:inline">
              {draftData?.estimate.estimateNumber ?? "New estimate"}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span
              className={cn(
                "text-xs",
                saveState === "saving" ? "text-mt-ink-3"
                : saveState === "saved" ? "text-green-600"
                : saveState === "error" ? "text-red-600"
                : "text-transparent",
              )}
              aria-live="polite"
            >
              {saveState === "saving" ? "Saving…"
              : saveState === "saved" ? "Saved"
              : saveState === "error" ? "Save failed"
              : "·"}
            </span>
            <motion.span
              key={total.toFixed(2)}
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, ease: CUBIC }}
              className="font-semibold tabular-nums text-primary text-lg"
            >
              {fmtCAD(total)}
            </motion.span>
          </div>
        </div>
      </header>

      {/* Canvas — centered max-w-4xl sheet */}
      <main className="mx-auto max-w-4xl px-4 pb-24 pt-10 md:px-8">
        {/* CLIENT */}
        <section aria-label="Client">
          <Label className="mb-2 block text-sm font-normal text-gray-500">
            Client
          </Label>
          <Controller
            control={control}
            name="clientId"
            render={({ field }) => (
              <ClientPicker value={field.value} onChange={(id) => field.onChange(id)} />
            )}
          />
          {!watch("clientId") ? (
            <p className="mt-2 text-xs text-mt-ink-3">
              Pick a client before the first autosave. The builder won't persist a draft without one.
            </p>
          ) : null}
        </section>

        <hr className="my-10 border-gray-200" />

        {/* LINE ITEMS */}
        <section aria-label="Line items">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-sm font-normal text-gray-500">Line items</h2>
            <div className="flex items-center gap-2">
              <motion.button
                type="button" whileTap={TAP}
                onClick={() => addItem(null)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-mt-ink hover:bg-mt-surface-2"
                aria-label="Add line item"
              >
                <Plus size={14} /> Add item
              </motion.button>
              <motion.button
                type="button" whileTap={TAP}
                onClick={addPackage}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-mt-ink hover:bg-mt-surface-2"
                aria-label="Add package"
              >
                <PackageIcon size={14} /> Add package
              </motion.button>
            </div>
          </div>

          {/* Column header row */}
          <div className="grid grid-cols-[auto_1fr_7rem_8rem_7rem_auto] gap-3 px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-mt-ink-4">
            <div />
            <div>Description</div>
            <div className="text-right">Qty</div>
            <div className="text-right">Unit price</div>
            <div className="text-right">Total</div>
            <div />
          </div>

          {/* PACKAGES */}
          <AnimatePresence initial={false}>
            {packagesField.fields.map((pkg, pkgIdx) => {
              const scope = groupedFields.byPkg.get(pkg.clientKey) ?? [];
              return (
                <motion.section layout key={pkg._fk} {...LINE_MOTION}
                  className="mt-4 border-l-2 border-primary/30 pl-4"
                  aria-label={`Package: ${pkg.name}`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <PackageIcon size={14} className="text-primary" />
                    <Input
                      {...register(`packages.${pkgIdx}.name`)}
                      placeholder="Package name"
                      aria-label="Package name"
                      aria-invalid={!!errors.packages?.[pkgIdx]?.name}
                      className="h-8 max-w-xs text-sm font-medium"
                    />
                    <motion.button
                      type="button" whileTap={TAP}
                      onClick={() => {
                        // Release items from this package back to ungrouped.
                        const items = getValues("lineItems");
                        items.forEach((li, i) => {
                          if (li.packageClientKey === pkg.clientKey) {
                            setValue(`lineItems.${i}.packageClientKey`, null, { shouldDirty: true });
                          }
                        });
                        packagesField.remove(pkgIdx);
                      }}
                      className="ml-auto flex h-7 w-7 items-center justify-center rounded text-mt-ink-3 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Remove package ${pkg.name}`}
                    >
                      <Trash2 size={14} />
                    </motion.button>
                  </div>
                  {errors.packages?.[pkgIdx]?.name ? (
                    <p className="mb-1 text-xs text-red-600">{errors.packages[pkgIdx]?.name?.message}</p>
                  ) : null}
                  <ul className="space-y-1">
                    <AnimatePresence initial={false}>
                      {scope.map((idx, posInScope) => (
                        <LineItemRow
                          key={lineItemsField.fields[idx]._fk}
                          form={form}
                          fieldIndex={idx}
                          catalog={catalog}
                          onRemove={() => lineItemsField.remove(idx)}
                          onMoveUp={() => moveItem(idx, -1)}
                          onMoveDown={() => moveItem(idx, 1)}
                          canMoveUp={posInScope > 0}
                          canMoveDown={posInScope < scope.length - 1}
                        />
                      ))}
                    </AnimatePresence>
                  </ul>
                  <motion.button
                    type="button" whileTap={TAP}
                    onClick={() => addItem(pkg.clientKey)}
                    className="mt-1 inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-mt-ink-3 hover:bg-mt-surface-2 hover:text-mt-ink"
                    aria-label={`Add item to ${pkg.name}`}
                  >
                    <Plus size={12} /> Add item to package
                  </motion.button>
                </motion.section>
              );
            })}
          </AnimatePresence>

          {/* UNGROUPED */}
          <ul className="mt-4 space-y-1">
            <AnimatePresence initial={false}>
              {groupedFields.ungrouped.map((idx, posInScope) => (
                <LineItemRow
                  key={lineItemsField.fields[idx]._fk}
                  form={form}
                  fieldIndex={idx}
                  catalog={catalog}
                  onRemove={() => lineItemsField.remove(idx)}
                  onMoveUp={() => moveItem(idx, -1)}
                  onMoveDown={() => moveItem(idx, 1)}
                  canMoveUp={posInScope > 0}
                  canMoveDown={posInScope < groupedFields.ungrouped.length - 1}
                />
              ))}
            </AnimatePresence>
          </ul>

          {lineItemsField.fields.length === 0 && packagesField.fields.length === 0 ? (
            <div className="mt-6 rounded-md border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-mt-ink-3">
              No items yet — add a line item or a package to get started.
            </div>
          ) : null}

          {/* Totals */}
          <div className="ml-auto mt-8 w-full max-w-xs">
            <div className="flex items-baseline justify-between py-1 text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span className="tabular-nums text-mt-ink">{fmtCAD(subtotal)}</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between border-t border-gray-200 pt-2">
              <span className="font-semibold text-mt-ink">Total</span>
              <motion.span
                key={total.toFixed(2)}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ duration: 0.15 }}
                className="font-semibold tabular-nums text-primary text-lg"
              >
                {fmtCAD(total)}
              </motion.span>
            </div>
          </div>
        </section>

        <hr className="my-10 border-gray-200" />

        {/* TERMS / VALID UNTIL / NOTES */}
        <section aria-label="Terms and notes" className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <Label className="mb-2 block text-sm font-normal text-gray-500">Valid until</Label>
            <Input type="date" {...register("validUntil")} aria-label="Valid until" />
          </div>
          <div className="md:col-span-2">
            <Label className="mb-2 block text-sm font-normal text-gray-500">Terms</Label>
            <Textarea {...register("terms")} rows={2} placeholder="Payment terms, cancellation policy, etc." aria-label="Terms" />
          </div>
          <div className="md:col-span-2">
            <Label className="mb-2 block text-sm font-normal text-gray-500">Notes</Label>
            <Textarea {...register("notes")} rows={2} placeholder="Internal or client-facing notes" aria-label="Notes" />
          </div>
        </section>

        <div className="mt-10 flex items-center justify-end gap-3">
          <motion.span whileTap={TAP}>
            <Button
              type="button"
              variant="default"
              onClick={onGeneratePreview}
              disabled={previewSubmitting}
            >
              {previewSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Saving…
                </span>
              ) : "Generate Preview"}
            </Button>
          </motion.span>
        </div>
      </main>
    </div>
  );
}
