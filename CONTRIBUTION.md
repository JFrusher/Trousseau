# Contributing to Trousseau

Thank you for taking the time to contribute! We welcome bug fixes, documentation improvements, feature additions, and performance enhancements.

## Code of Conduct

Please treat everyone with respect, patience, and kindness. We want this project to be a welcoming environment for developers of all backgrounds.

---

## Development Setup

### Prerequisites

* **Node.js**: v22 or higher
* **npm**: v10 or higher

### Getting Started

1. **Fork and clone the repository:**

   ```bash
   git clone [https://github.com/YOUR-USERNAME/Trousseau.git](https://github.com/YOUR-USERNAME/Trousseau.git)
   cd Trousseau
    ```

2. **Install dependencies:**
```bash
npm ci

```


3. **Build core packages:**
Before running tests or launching workspace apps, compile the shared core packages:
```bash
npm run build

```


4. **Start the local development server:**
```bash
npm run dev -w suite

```



---

## Development Workflow

### Project Structure

* `/src` — Core domain logic and shared library modules (`@jfrusher/trousseau`).
* `/suite` — Next.js App Router application workspace.
* `/scripts` — Build and validation utilities.

### Branch Naming Conventions

Use descriptive branch names prefixed with the category of work:

* `feat/your-feature-name`
* `fix/bug-description`
* `docs/update-readme`
* `refactor/component-cleanup`

---

## Testing & Quality Checks

Our CI pipeline enforces type safety, unit testing, and linting. Make sure these pass locally before submitting a Pull Request.

### Commands

| Action | Command |
| --- | --- |
| **Typecheck Root** | `npm run typecheck` |
| **Typecheck Suite** | `npm run typecheck -w suite` |
| **Run Core Tests** | `npm run test` |
| **Run Suite Tests** | `npm run test -w suite` |
| **Build Core** | `npm run build` |
| **Build Suite** | `npm run build -w suite` |

> **Note:** Running tests or typechecks on workspace applications requires the core package (`npm run build`) to be compiled first.

---

## Submitting a Pull Request

1. **Keep changes focused:** A PR should address a single bug fix or feature enhancement.
2. **Add tests:** Ensure new features or bug fixes include corresponding unit or integration tests in Vitest.
3. **Pass local checks:** Run typechecks and tests locally across all workspaces.
4. **Push and open PR:** Push your branch to GitHub and open a Pull Request against the `main` branch.
5. **CI Status:** Ensure all GitHub Actions status checks pass.

Thank you for contributing!

