# MergeTasks Design Overhaul — Brainstorm v2

## User Direction
- Cool neutral palette with brand color (#654BF9) as underlay accent
- All-dark theme throughout
- Minimal data density — spacious, less is more
- Webstore: Apple Store meets B2B — huge imagery, breathing room, but professional/enterprise
- Smooth page transitions and animations
- Premium, enterprise-grade, minimalist, sleek — "this costs $50k/year" energy
- Square-ish UI/UX — sharp, confident geometry

---

<response>
<text>

## Idea 1: "Obsidian Vault" — Monochromatic Depth System

**Design Movement:** Neo-Brutalist Minimalism meets Swiss Grid — the precision of Dieter Rams applied to dark interfaces. Think Linear meets Bloomberg Terminal's confidence.

**Core Principles:**
1. Monochromatic layering — build depth through 4-5 shades of near-black/charcoal, never flat
2. Negative space as architecture — darkspace is the primary design element
3. Single-accent discipline — #654BF9 appears only at moments of action or importance
4. Typography-driven hierarchy — size and weight do all the work, no decorative elements

**Color Philosophy:**
- Base: #09090B, Surface 1: #0F0F12, Surface 2: #16161A, Surface 3: #1C1C22
- Border: #27272A, Text primary: #FAFAFA, Text secondary: #71717A, Text tertiary: #52525B
- Accent: #654BF9 sparingly

**Signature Elements:** Ghost borders on hover, accent glow on CTAs, monospace metrics
**Typography:** Inter (700) headlines, Inter (400/500) body, Space Mono for data

</text>
<probability>0.08</probability>
</response>

<response>
<text>

## Idea 2: "Carbon Fiber" — Textured Dark Luxury

**Design Movement:** Automotive luxury UI meets fintech precision — the dashboard of a Porsche Taycan crossed with Stripe's information architecture.

**Core Principles:**
1. Textured darkness — subtle noise/grain overlays on dark surfaces for tactile depth
2. Asymmetric balance — deliberate off-grid placement creates tension and interest
3. Accent as signal — purple appears only where the user should look or act
4. Micro-typography — obsessive attention to font weight, spacing, and case

**Color Philosophy:**
- Canvas: #08080A (deepest black with blue undertone)
- Panel: #0D0D10 (sidebar, nav)
- Card: #111114 (content containers)
- Elevated: #18181C (modals, dropdowns)
- Border subtle: #1E1E24
- Border active: #654BF9 at 40%
- Text bright: #F4F4F5
- Text standard: #A1A1AA
- Text dim: #63636B
- Brand: #654BF9
- Brand wash: linear-gradient(135deg, rgba(101,75,249,0.06), transparent)

**Layout Paradigm:**
- Sidebar: 260px, fixed, with subtle grain texture
- Content: fluid, max-width 1400px
- Cards: 0px border-radius (sharp squares), 16px gaps
- Asymmetric hero sections on webstore — 60/40 splits, full-bleed imagery

**Signature Elements:**
1. CSS grain texture at 3% opacity on all dark surfaces
2. "Purple thread" — 1px #654BF9 line on active/selected items
3. Square corners everywhere — 0px border-radius is the signature

**Interaction Philosophy:**
- Precision hover with measured transitions (200ms)
- Progressive disclosure on hover
- Page transitions: crossfade + scale (0.98→1.0), 250ms

**Animation:**
- Page transition: opacity crossfade 250ms + scale 0.98→1.0
- Card hover: border-color fades to #654BF9 at 30%, 200ms
- Metric counters: staggered count-up with 50ms delay
- Sidebar nav: active indicator slides vertically
- Webstore product hover: image scale 1.0→1.03, 300ms

**Typography System:**
- Headlines: Space Grotesk (700) — geometric, technical, premium
- Body: Inter (400/450) — clean readability
- Labels: Inter (600), ALL-CAPS, letter-spacing 0.08em, 11px
- Metrics: Space Grotesk (600) — large, confident numbers
- Sizes: 56px hero, 28px h2, 13px body, 11px labels

</text>
<probability>0.06</probability>
</response>

<response>
<text>

## Idea 3: "Void Architecture" — Spatial Dark Minimalism

**Design Movement:** Japanese Ma (negative space) philosophy applied to enterprise software — emptiness between elements is as important as the elements themselves.

**Core Principles:**
1. Ma (間) — intentional emptiness creates rhythm
2. Reduction to essence — every element justifies its existence
3. Material honesty — dark surfaces feel like materials (matte, satin)
4. Quiet confidence — authority comes from restraint

**Color Philosophy:**
- Void: #0A0A0C, Matte: #101013, Satin: #161619, Edge: #222228
- Silk: #EDEDEF (text), Smoke: #8B8B94, Ash: #5A5A63
- Amethyst: #654BF9, Amethyst glow: rgba(101,75,249,0.08)

**Signature Elements:** Shadow lines instead of borders, amethyst pulse on CTAs, material layers
**Typography:** DM Sans (700) display, DM Sans (400) body, Space Mono metrics

</text>
<probability>0.07</probability>
</response>

---

## SELECTED: Idea 2 — "Carbon Fiber"

Best match for the user's direction. Sharp square corners, textured darkness, and automotive luxury feel deliver "premium enterprise but not boring." Asymmetric webstore layouts nail "Apple Store meets B2B."

### Design Commitments:
- **0px border-radius everywhere** — sharp, square, confident
- **All-dark theme** with layered near-blacks (#08080A → #0D0D10 → #111114 → #18181C)
- **Space Grotesk + Inter** font pairing
- **Purple (#654BF9) as signal only** — action points, active states, key metrics
- **Grain texture overlay** on surfaces for tactile depth
- **Page transitions** with crossfade + subtle scale
- **ALL-CAPS labels** with wide letter-spacing for enterprise feel
- **Generous whitespace** — 32px+ padding, spacious layouts
- **Webstore** — full-bleed imagery, asymmetric layouts, Apple-meets-B2B
