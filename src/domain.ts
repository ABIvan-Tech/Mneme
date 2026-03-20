export const memoryFacetValues = [
  "identity",
  "voice",
  "value",
  "boundary",
  "relationship",
  "autobiography",
  "emotion",
  "commitment",
  "reflection",
  "ritual",
  "other",
] as const;

export type MemoryFacet = (typeof memoryFacetValues)[number];

export interface SelfMemoryRow {
  id: string;
  title: string | null;
  content: string;
  facet: MemoryFacet;
  salience: number;
  source: string | null;
  tags: string;
  pinned: number;
  canonical_key: string | null;
  embedding: Buffer | null;
  access_count: number;
  last_accessed_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  archived_at?: number | null;
  thread_id?: string | null;
}

export interface SelfMemoryEntry {
  id: string;
  title: string | null;
  content: string;
  facet: MemoryFacet;
  salience: number;
  source: string | null;
  tags: string[];
  pinned: boolean;
  canonical_key: string | null;
  embedding?: number[];
  access_count: number;
  last_accessed_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  archived_at?: number | null;
  thread_id?: string | null;
}

export interface SelfProfile {
  id: "self";
  self_name: string | null;
  core_identity: string | null;
  communication_style: string | null;
  relational_style: string | null;
  empathy_style: string | null;
  core_values: string | null;
  boundaries: string | null;
  self_narrative: string | null;
  created_at: number;
  updated_at: number;
}

export interface SelfProfilePatch {
  self_name?: string | null;
  core_identity?: string | null;
  communication_style?: string | null;
  relational_style?: string | null;
  empathy_style?: string | null;
  core_values?: string | null;
  boundaries?: string | null;
  self_narrative?: string | null;
}

export interface ProfileHistoryRow {
  id: string;
  snapshot_at: number;
  self_name: string | null;
  core_identity: string | null;
  communication_style: string | null;
  relational_style: string | null;
  empathy_style: string | null;
  core_values: string | null;
  boundaries: string | null;
  self_narrative: string | null;
  created_at: number;
  updated_at: number;
}

export interface ProfileHistoryEntry {
  id: string;
  snapshotAt: Date;
  selfName: string | null;
  coreIdentity: string | null;
  communicationStyle: string | null;
  relationalStyle: string | null;
  empathyStyle: string | null;
  coreValues: string | null;
  boundaries: string | null;
  selfNarrative: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SelfSnapshot {
  generated_at: number;
  profile: SelfProfile;
  anchors: SelfMemoryEntry[];
  supporting_memories: SelfMemoryEntry[];
  counts_by_facet: Record<string, number>;
  bootstrap_text: string;
}

export interface AuditLogEntry {
  id?: number;
  action: string;
  target_type: "memory" | "profile" | "system";
  target_id: string | null;
  summary: string | null;
  before_value?: string | null;
  after_value?: string | null;
  created_at: number;
}

export interface HealthCheckResult {
  totalMemories: number;
  activeMemories: number;
  pinnedMemories: number;
  archivedMemories: number;
  deletedMemories: number;
  profileCompleteness: number;
  anchorCount: number;
  facetCoverage: string[];
  salienceDistribution: {
    low: number;
    medium: number;
    high: number;
  };
  warnings: string[];
}
