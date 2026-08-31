Here is the complete setup to consolidate your separate micro-tools into a single, cohesive, client-side web application hosted on Vercel.

By keeping it **local-first** (using a unified **Zustand** store synced to `localStorage` with JSON/CSV export capabilities), you eliminate the need for complex auth databases, paid backend servers, or security liabilities—while giving users instant data sharing across all tools in the suite.

---

### Step 1: The Master Executable Prompt for Claude Code

Paste this prompt directly into your terminal or AI coding agent inside your unified project root:

```text
Read PRD.md thoroughly before writing any code.

Refactor and consolidate the existing standalone tools (seating planner, place card generator, day timeline, job delegator) into a single, cohesive, local-first web application called "Tableaux Suite" deployed on Vercel.

Adhere strictly to these architecture & design guidelines:

1. GLOBAL STATE & LOCAL STORAGE ENGINE
   - Implement a unified Zustand store (lib/store/useTableauxStore.ts) backed by localStorage.
   - The global store must hold: Guests, Tables, Timeline Events, Tasks/Delegations, and Global Wedding Metadata (names, date, venue).
   - Ensure tools read from this single source of truth. When a guest is assigned a table in the Seating Planner, their table number and food selection automatically update in the Place Card Generator.
   - Add a global "Data Manager" modal accessible from the nav bar allowing single-click JSON backup export, JSON restore import, and CSV guest list upload.

2. UI & DESIGN SYSTEM (Tableaux Palette)
   - Use Next.js 14+ (App Router), Tailwind CSS, Lucide Icons, and Framer Motion.
   - Maintain the warm, editorial "Tableaux" aesthetic:
     * Backgrounds: Warm Off-White (#FDFBF7) / Soft Stone (#F4F1EA)
     * Typography & Borders: Deep Charcoal (#1C1917) and Muted Slate (#44403C)
     * Accents: Warm Champagne Gold (#D4AF37), Sage Green (#849E86), and Dusty Rose (#C48B8B)
   - Build a clean top navigation header present on all pages: Logo, Tool Switcher Tabs, Global Guest Count Badge, and Data Import/Export Button.

3. PAGE ROUTING & TOOL INTEGRATION
   - / (Home): High-converting landing page explaining the free, open-source, zero-signup philosophy, plus a "Quick Stats" summary of active local data.
   - /seating: Drag-and-drop interactive canvas for tables and guest seat assignments.
   - /place-cards: PDF place card & table menu/sign generator using live guest/table data.
   - /timeline: Interactive day-of run-of-show timeline editor with vendor filter tags.
   - /delegation: Kanban/List view for wedding party job assignments with printable role summaries.

4. EXECUTION PLAN
   - Step 1: Initialize Next.js App Router, Tailwind theme config with Tableaux palette, and Zustand store.
   - Step 2: Build shared Navigation, Landing Page, and Data Import/Export Modal.
   - Step 3: Migrate and unify core algorithms/UI from sub-repos into clean React modules under app/(tools)/.
   - Step 4: Verify zero-loss local JSON exports and build production bundle via `npm run build`.

Execute Step 1 now.

```

---

### Step 2: Product Requirements Document (`PRD.md`)

Save the following text as `PRD.md` in the root of your project:

```markdown
# Product Requirements Document (PRD) — Tableaux Unified Suite

## 1. Executive Summary
**Tableaux Suite** is a privacy-first, zero-signup, open-source wedding management platform. It unifies four standalone micro-utilities (Seating Planner, Place Card PDF Generator, Day-of Timeline Engine, and Task Delegator) into a single responsive web application. The platform operates 100% client-side, using `localStorage` for automatic state persistence and JSON/CSV for cross-device portability.

---

## 2. Technical Stack & Target Infrastructure
* **Framework:** Next.js (App Router, Static Export compatible)
* **Styling:** Tailwind CSS + Radix UI primitives / `shadcn/ui`
* **State Management:** Zustand (with `persist` middleware to `localStorage`)
* **PDF Engine:** `@react-pdf/renderer` or native print CSS layouts (`@media print`)
* **Icons & Animation:** `lucide-react`, `framer-motion`
* **Hosting:** Vercel (Edge network, zero serverless database cost)

---

## 3. Core Data Schema (Unified JSON State)

```typescript
export interface Guest {
  id: string;
  name: string;
  plusOneOf?: string;
  tableId?: string;
  seatNumber?: number;
  dietaryRequirements?: string;
  role?: 'VIP' | 'Bridal Party' | 'Groom Party' | 'Family' | 'Guest';
  isAttending: boolean;
}

export interface Table {
  id: string;
  name: string; // e.g., "Table 1" or "Top Table"
  capacity: number;
  shape: 'round' | 'rectangle';
  position: { x: number; y: number };
}

export interface TimelineEvent {
  id: string;
  time: string; // e.g., "14:30"
  title: string;
  location?: string;
  assignedRoles: string[]; // e.g., ["Best Man", "Photographer"]
  notes?: string;
}

export interface Task {
  id: string;
  title: string;
  assigneeName: string;
  assigneeRole: string; // e.g., "Usher - Ben"
  category: 'Morning Prep' | 'Ceremony' | 'Reception' | 'Pack-down';
  isCompleted: boolean;
}

export interface TableauxState {
  metadata: {
    coupleNames: string;
    weddingDate: string;
    venueName: string;
  };
  guests: Guest[];
  tables: Table[];
  timeline: TimelineEvent[];
  tasks: Task[];
}

```

---

## 4. Module Specifications

### Module 0: Universal Layout & Landing Page (`/`)

* **Header & Nav:** Persistent top bar with logo, tab links to tools, active guest/table counters, and a **"Backup & Restore Data"** button.
* **Landing Section:** Editorial hero section detailing the core promise: *“Free, open-source wedding planning. No paywalls, no emails collected, total privacy.”*
* **Local Dashboard:** Interactive card summaries displaying remaining unassigned guests, upcoming timeline events, and incomplete wedding party tasks.

### Module 1: Seating Planner (`/seating`)

* **Interactive Canvas:** Drag-and-drop or click-to-assign placement of guests to tables.
* **Auto-Balance & Real-Time Stats:** Visual indicator showing table occupancy (e.g., `8 / 10 seats filled`) and unassigned guest sidebar.
* **Auto-Sync:** Updating a guest’s table here immediately updates their record in the Place Card and Delegation modules.

### Module 2: Place Card & Signage Generator (`/place-cards`)

* **Template Customizer:** Live canvas preview of printable place cards, folding tent cards, and table seating rosters.
* **Data Binding:** Auto-populates guest names, assigned table names, and dietary badges directly from the global state.
* **PDF Export:** High-DPI browser rendering with standard trim lines for local home printing or print shop exports.

### Module 3: Day-of Timeline Engine (`/timeline`)

* **Chronological Schedule Editor:** Drag-and-drop timeline block builder with time calculations (e.g., duration tracking).
* **Vendor & Party Filter:** Filter view by role (e.g., "Photographer View", "Groom Party View", "Caterer Run-Sheet").
* **Printable Run-Sheet:** Optimized `@media print` layout to print crisp A4/Letter physical sheets for suppliers.

### Module 4: Task Delegator (`/delegation`)

* **Role-Based Task Manager:** Assign critical wedding-day duties to groomsmen, bridesmaids, ushers, and family members.
* **Personalized Summary Cards:** Export or print individual one-page "duty cards" for specific helpers (e.g., *Ed's Best Man Duty List*).

---

## 5. Design System & Color Palette (Tableaux Theme)

```javascript
// tailwind.config.js theme extension
colors: {
  tableaux: {
    bg: '#FDFBF7',         // Warm Off-White
    surface: '#F4F1EA',    // Soft Stone
    border: '#E7E2D7',     // Neutral Cream Border
    text: '#1C1917',       // Deep Charcoal
    muted: '#78716C',      // Warm Slate Gray
    accent: '#D4AF37',     // Warm Champagne Gold
    sage: '#849E86',       // Muted Sage
    rose: '#C48B8B',       // Dusty Rose
  }
}

```

---

## 6. Non-Functional & Security Requirements

1. **Zero External API Dependencies:** Must run completely offline after initial page load.
2. **Performance:** Initial JS bundle size must remain under $200\text{ KB}$ gzipped.
3. **Data Safety:** Store updates write instantly to `localStorage`. Provide an auto-download prompt for JSON backup if browser storage clearing is detected.

```

---

<ElicitationsGroup message="Ready to execute this consolidation?">

  <Elicitation label="Draft the Zustand store file (lib/store/useTableauxStore.ts)" query="Show me the full TypeScript implementation for the central Zustand store with localStorage persistence."/>

  <Elicitation label="Design the Place Card PDF Generator layout component" query="Show me how to code the React Place Card PDF rendering module using the unified guest state."/>

</ElicitationsGroup>

```