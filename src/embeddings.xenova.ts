import { pipeline, env, type PipelineType } from "@xenova/transformers";

import type { EmbeddingProvider } from "./embeddings.js";
import type { Logger } from "./logger.js";

// Disable local models checking since we'll download to a specific cache dir
env.allowLocalModels = false;
env.useBrowserCache = false;

export class XenovaEmbeddingProvider implements EmbeddingProvider {
  private extractor: unknown = null;
  public readonly dimensions: number = 384; // all-MiniLM-L6-v2 produces 384-dimensional embeddings

  constructor(
    private readonly modelName: string = "Xenova/all-MiniLM-L6-v2",
    private readonly logger?: Logger,
  ) {}

  public async init(): Promise<void> {
    if (this.extractor) {
      return;
    }

    this.logger?.info("Initializing Xenova embedding provider", {
      model: this.modelName,
    });

    try {
      this.extractor = await pipeline("feature-extraction" as PipelineType, this.modelName, {
        progress_callback: (info: { status?: string; progress?: number; file?: string }) => {
          if (info.status === "progress" && info.progress === 100) {
            this.logger?.debug("Model download progress", { file: info.file, status: "complete" });
          }
        },
      });
      this.logger?.info("Xenova embedding provider initialized successfully");
    } catch (error) {
      this.logger?.error("Failed to initialize Xenova embedding provider", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  public async embed(text: string): Promise<number[]> {
    if (!this.extractor) {
      await this.init();
    }

    try {
      // Use pooling to get a single vector per sentence
      const output = await (this.extractor as any)(text, { pooling: "mean", normalize: true });
      return Array.from(output.data);
    } catch (error) {
      this.logger?.error("Failed to generate embedding", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
