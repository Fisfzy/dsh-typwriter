// Side-effect module: phase A of the migration, run at IMPORT time.
//
// This must be the FIRST import in src/main.ts. Several modules read their storage key at module
// scope (the theme, the recents list, the layout store), and import order is the only thing that
// puts this before them. It imports nothing that touches storage - see migrate.ts.
import { migrateLocalStorage } from './migrate';

migrateLocalStorage();
