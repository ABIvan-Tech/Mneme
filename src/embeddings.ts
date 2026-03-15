export interface EmbeddingProvider {
  /**
   * Initialize the provider (e.g., download models, establish connections).
   */
  init(): Promise<void>;

  /**
   * Generate an embedding vector for the given text.
   */
  embed(text: string): Promise<number[]>;

  /**
   * The dimension size of the vectors produced by this provider.
   */
  get dimensions(): number;
}
