import { defineConfig } from "prisma/config";

// Generation requires no database connection. Never run Prisma schema push/migrate
// against this partial mapping: db/migrations remains the schema authority.
export default defineConfig({ schema: "prisma/schema.prisma" });
