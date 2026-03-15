import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import { XenovaEmbeddingProvider } from "../src/embeddings.xenova.js";
import { createLogger } from "../src/logger.js";
import { runMigrations } from "../src/migrations.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, {
    service: "mnemo-self",
    component: "backfill",
  });

  const db = openDatabase(config.sqlitePath);
  runMigrations(db, logger);

  logger.info("Initializing embedding provider...");
  const provider = new XenovaEmbeddingProvider("Xenova/all-MiniLM-L6-v2", logger);
  await provider.init();

  const getMissing = db.prepare(
    `SELECT id, content FROM self_memory WHERE deleted_at IS NULL AND embedding IS NULL`
  );

  const updateEmbedding = db.prepare(
    `UPDATE self_memory SET embedding = ? WHERE id = ?`
  );

  const missing = getMissing.all() as { id: string; content: string }[];

  if (missing.length === 0) {
    logger.info("All memories have embeddings. Nothing to do.");
    process.exit(0);
  }

  logger.info(`Found ${missing.length} memories requiring embeddings. Backfilling...`);

  let count = 0;
  for (const { id, content } of missing) {
    try {
      if (!content.trim()) continue;
      
      const vector = await provider.embed(content);
      const buffer = Buffer.from(new Float32Array(vector).buffer);
      
      updateEmbedding.run(buffer, id);
      count++;
      
      if (count % 100 === 0) {
        logger.info(`Progress: ${count} / ${missing.length}`);
      }
    } catch (err) {
      logger.error(`Failed to backfill memory ${id}`, { error: String(err) });
    }
  }

  logger.info(`Backfill complete. Updated ${count} memories.`);
  db.close();
}

main().catch(console.error);
