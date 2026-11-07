import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { parseRuntimeConfiguration } from "./app/configuration/environment.js";

// Compatibility entry point for server/CLI environment loading. Feature modules
// receive typed options; tests may parse isolated inputs without reading a file.
dotenv.config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
export const config = parseRuntimeConfiguration(process.env);
