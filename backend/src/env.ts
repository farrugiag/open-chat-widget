import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");

// Load root env files so backend works when started from workspace subdirectories.
dotenv.config({ path: path.join(projectRoot, ".env") });
dotenv.config({ path: path.join(projectRoot, ".env.local"), override: true });
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CONVEX_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  WIDGET_API_KEY: z.string().min(1),
  CORS_ORIGIN: z.string().default("*"),
  WIDGET_BUNDLE_PATH: z.string().default("../widget/dist/chat-widget.js"),
  MAX_HISTORY_MESSAGES: z.coerce.number().int().positive().default(30)
});

export const env = envSchema.parse(process.env);
