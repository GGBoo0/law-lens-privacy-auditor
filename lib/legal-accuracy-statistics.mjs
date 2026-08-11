const WILSON_95_Z = 1.959963984540054;

export const CLUSTER_BOOTSTRAP_METHOD_VERSION = "1.0.0";
export const SEEDED_PRNG_ALGORITHM = "fnv1a-32-utf16+mulberry32";

export const DEFAULT_BOOTSTRAP_OPTIONS = Object.freeze({
  confidenceLevel: 0.95,
  replicates: 10_000,
  minimumClusters: 30,
  minimumReplicates: 1_000,
  minimumValidFraction: 0.99,
  seed: "law-lens-legal-accuracy-v1",
});

const BINARY_METRICS = new Set([
  "accuracy",
  "f1",
  "precision",
  "recall",
  "specificity",
]);

function assertNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function unavailableResult(reason, details = {}) {
  return {
    status: "unavailable",
    reason,
    estimate: details.estimate ?? null,
    lower: null,
    upper: null,
    ...details,
  };
}

/**
 * Computes a fixed 95% Wilson score interval for a binomial proportion.
 *
 * The result is deliberately unavailable for a zero denominator.  Boundary
 * observations such as 0/n and n/n remain calculable and are not replaced by
 * the misleading intervals [0, 0] or [1, 1].
 *
 * @param {number} successes Integer count in [0, total].
 * @param {number} total Non-negative integer denominator.
 * @returns {{status: "ok" | "unavailable", reason: string | null,
 *   method: "wilson_score", confidenceLevel: 0.95, successes: number,
 *   total: number, estimate: number | null, lower: number | null,
 *   upper: number | null}}
 */
export function wilson95Interval(successes, total) {
  assertNonNegativeInteger(successes, "successes");
  assertNonNegativeInteger(total, "total");
  if (successes > total) {
    throw new RangeError("successes must not exceed total");
  }

  const base = {
    method: "wilson_score",
    confidenceLevel: 0.95,
    successes,
    total,
  };
  if (total === 0) {
    return unavailableResult("zero_denominator", base);
  }

  const estimate = successes / total;
  const zSquared = WILSON_95_Z ** 2;
  const denominator = 1 + zSquared / total;
  const center = (estimate + zSquared / (2 * total)) / denominator;
  const halfWidth =
    (WILSON_95_Z / denominator) *
    Math.sqrt(
      (estimate * (1 - estimate)) / total +
        zSquared / (4 * total ** 2),
    );

  return {
    status: "ok",
    reason: null,
    ...base,
    estimate,
    lower: successes === 0 ? 0 : Math.max(0, center - halfWidth),
    upper: successes === total ? 1 : Math.min(1, center + halfWidth),
  };
}

function hashSeed(seed) {
  const text = String(seed);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Creates a deterministic PRNG with a stable string-to-seed mapping.
 *
 * The returned Mulberry32 stream is suitable for reproducible resampling, not
 * for cryptography.  The algorithm and UTF-16/FNV-1a seed mapping are part of
 * the persisted evaluation contract and should only change with a new method
 * version.
 *
 * @param {string | number | bigint} seed Stable evaluation seed.
 * @returns {() => number} Function returning values in [0, 1).
 */
export function createSeededPrng(seed = DEFAULT_BOOTSTRAP_OPTIONS.seed) {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function percentile(sortedValues, probability) {
  if (sortedValues.length === 0) return null;
  if (probability <= 0) return sortedValues[0];
  if (probability >= 1) return sortedValues.at(-1);
  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const weight = position - lowerIndex;
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[Math.min(lowerIndex + 1, sortedValues.length - 1)];
  return lower + weight * (upper - lower);
}

function normalizeBootstrapOptions(options) {
  const normalized = { ...DEFAULT_BOOTSTRAP_OPTIONS, ...options };
  assertNonNegativeInteger(normalized.replicates, "replicates");
  assertNonNegativeInteger(normalized.minimumClusters, "minimumClusters");
  assertNonNegativeInteger(
    normalized.minimumReplicates,
    "minimumReplicates",
  );
  if (normalized.minimumClusters < 2) {
    throw new RangeError("minimumClusters must be at least 2");
  }
  if (normalized.minimumReplicates < 2) {
    throw new RangeError("minimumReplicates must be at least 2");
  }
  if (
    !Number.isFinite(normalized.confidenceLevel) ||
    normalized.confidenceLevel <= 0 ||
    normalized.confidenceLevel >= 1
  ) {
    throw new RangeError("confidenceLevel must be between 0 and 1");
  }
  if (
    !Number.isFinite(normalized.minimumValidFraction) ||
    normalized.minimumValidFraction <= 0 ||
    normalized.minimumValidFraction > 1
  ) {
    throw new RangeError("minimumValidFraction must be greater than 0 and at most 1");
  }
  if (typeof normalized.clusterBy !== "function") {
    normalized.clusterBy = (item) => item?.companyId;
  }
  return normalized;
}

function groupByCluster(items, clusterBy) {
  const clusters = new Map();
  for (const [index, item] of items.entries()) {
    const clusterId = clusterBy(item, index);
    if (typeof clusterId !== "string" || clusterId.trim().length === 0) {
      throw new TypeError(
        `clusterBy must return a non-empty string for item ${index}`,
      );
    }
    const cluster = clusters.get(clusterId) ?? [];
    cluster.push(item);
    clusters.set(clusterId, cluster);
  }
  return clusters;
}

/**
 * Computes a deterministic company-cluster percentile bootstrap interval.
 *
 * Each replicate samples the same number of clusters as the observed corpus,
 * with replacement, and includes every item from each selected company.  This
 * preserves within-company dependence.  `metric` receives the flattened
 * resample and metadata containing `sampledClusterIds`; it must return a finite
 * number or null when that replicate is not estimable.
 *
 * @template T
 * @param {T[]} items Evaluation-unit rows.
 * @param {(sample: T[], context: {phase: "point" | "replicate",
 *   replicateIndex: number | null, sampledClusterIds: unknown[]}) =>
 *   number | null | undefined} metric Metric callback.
 * @param {{clusterBy?: (item: T, index: number) => unknown,
 *   confidenceLevel?: number, replicates?: number, minimumClusters?: number,
 *   minimumReplicates?: number, minimumValidFraction?: number,
 *   seed?: string | number | bigint, includeDistribution?: boolean}} [options]
 * @returns {{status: "ok" | "unavailable", reason: string | null,
 *   method: "company_cluster_percentile_bootstrap", confidenceLevel: number,
 *   estimate: number | null, lower: number | null, upper: number | null,
 *   clusterCount: number, itemCount: number, requestedReplicates: number,
 *   validReplicates: number, requiredValidReplicates: number,
 *   minimumValidFraction: number, methodVersion: string, seed: string,
 *   seedAlgorithm: string, distribution?: number[]}}
 */
export function companyClusterBootstrapInterval(items, metric, options = {}) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (typeof metric !== "function") {
    throw new TypeError("metric must be a function");
  }
  const config = normalizeBootstrapOptions(options);
  const requiredValidReplicates = Math.max(
    config.minimumReplicates,
    Math.ceil(config.replicates * config.minimumValidFraction),
  );
  const base = {
    method: "company_cluster_percentile_bootstrap",
    methodVersion: CLUSTER_BOOTSTRAP_METHOD_VERSION,
    confidenceLevel: config.confidenceLevel,
    clusterCount: 0,
    itemCount: items.length,
    requestedReplicates: config.replicates,
    validReplicates: 0,
    requiredValidReplicates,
    minimumValidFraction: config.minimumValidFraction,
    seed: String(config.seed),
    seedAlgorithm: SEEDED_PRNG_ALGORITHM,
  };
  if (items.length === 0) return unavailableResult("no_observations", base);

  const grouped = groupByCluster(items, config.clusterBy);
  const clusterIds = [...grouped.keys()].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  base.clusterCount = clusterIds.length;

  const estimate = metric(items, {
    phase: "point",
    replicateIndex: null,
    sampledClusterIds: clusterIds,
  });
  if (!Number.isFinite(estimate)) {
    return unavailableResult("non_finite_point_estimate", base);
  }
  if (clusterIds.length < config.minimumClusters) {
    return unavailableResult("insufficient_clusters", { ...base, estimate });
  }
  if (config.replicates < requiredValidReplicates) {
    return unavailableResult("insufficient_requested_replicates", {
      ...base,
      estimate,
    });
  }

  const random = createSeededPrng(config.seed);
  const distribution = [];
  for (let replicateIndex = 0; replicateIndex < config.replicates; replicateIndex += 1) {
    const sampledClusterIds = [];
    const sample = [];
    for (let draw = 0; draw < clusterIds.length; draw += 1) {
      const clusterId = clusterIds[Math.floor(random() * clusterIds.length)];
      sampledClusterIds.push(clusterId);
      sample.push(...grouped.get(clusterId));
    }
    const value = metric(sample, {
      phase: "replicate",
      replicateIndex,
      sampledClusterIds,
    });
    if (Number.isFinite(value)) distribution.push(value);
  }

  base.validReplicates = distribution.length;
  if (distribution.length < requiredValidReplicates) {
    return unavailableResult("insufficient_valid_replicates", {
      ...base,
      estimate,
      ...(config.includeDistribution ? { distribution } : {}),
    });
  }

  distribution.sort((left, right) => left - right);
  const tail = (1 - config.confidenceLevel) / 2;
  return {
    status: "ok",
    reason: null,
    ...base,
    estimate,
    lower: percentile(distribution, tail),
    upper: percentile(distribution, 1 - tail),
    ...(config.includeDistribution ? { distribution } : {}),
  };
}

function assertBinaryCounts(counts, index) {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    throw new TypeError(`countsOf must return an object for item ${index}`);
  }
  const normalized = {};
  for (const key of ["tp", "fp", "fn", "tn"]) {
    const value = counts[key] ?? 0;
    assertNonNegativeInteger(value, `countsOf item ${index}.${key}`);
    normalized[key] = value;
  }
  return normalized;
}

function sumBinaryCounts(items, countsOf) {
  return items.reduce(
    (totals, item, index) => {
      const counts = assertBinaryCounts(countsOf(item, index), index);
      for (const key of ["tp", "fp", "fn", "tn"]) {
        const nextValue = totals[key] + counts[key];
        if (!Number.isSafeInteger(nextValue)) {
          throw new RangeError(`summed ${key} count exceeds safe integer range`);
        }
        totals[key] = nextValue;
      }
      return totals;
    },
    { tp: 0, fp: 0, fn: 0, tn: 0 },
  );
}

/**
 * Computes a named binary-classification metric from confusion counts.
 * Undefined denominators return null instead of being reported as zero.
 *
 * @param {{tp?: number, fp?: number, fn?: number, tn?: number}} counts
 * @param {"accuracy" | "f1" | "precision" | "recall" | "specificity"} metric
 * @returns {number | null}
 */
export function binaryMetricFromCounts(counts, metric = "f1") {
  if (!BINARY_METRICS.has(metric)) {
    throw new RangeError(`Unsupported binary metric: ${metric}`);
  }
  const { tp, fp, fn, tn } = assertBinaryCounts(counts, 0);
  const denominators = {
    accuracy: tp + fp + fn + tn,
    f1: 2 * tp + fp + fn,
    precision: tp + fp,
    recall: tp + fn,
    specificity: tn + fp,
  };
  const numerators = {
    accuracy: tp + tn,
    f1: 2 * tp,
    precision: tp,
    recall: tp,
    specificity: tn,
  };
  return denominators[metric] > 0
    ? numerators[metric] / denominators[metric]
    : null;
}

/**
 * Convenience wrapper for clustered binary metrics, including F1.
 *
 * By default each input row is a company-level confusion-count object with a
 * `companyId`.  `countsOf` may instead derive `{tp, fp, fn, tn}` from a finer
 * evaluation-unit row; the generic bootstrap will still resample whole
 * companies rather than individual rows.
 *
 * @template T
 * @param {T[]} items Clustered confusion-count or evaluation-unit rows.
 * @param {{metric?: "accuracy" | "f1" | "precision" | "recall" |
 *   "specificity", countsOf?: (item: T, index: number) =>
 *   {tp?: number, fp?: number, fn?: number, tn?: number},
 *   clusterBy?: (item: T, index: number) => unknown,
 *   confidenceLevel?: number, replicates?: number, minimumClusters?: number,
 *   minimumReplicates?: number, minimumValidFraction?: number,
 *   seed?: string | number | bigint, includeDistribution?: boolean}} [options]
 * @returns {ReturnType<typeof companyClusterBootstrapInterval> &
 *   {binaryMetric: string, totals: {tp: number, fp: number, fn: number,
 *   tn: number}}}
 */
export function companyClusterBinaryInterval(items, options = {}) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  const {
    metric = "f1",
    countsOf = (item) => item,
    ...bootstrapOptions
  } = options;
  if (!BINARY_METRICS.has(metric)) {
    throw new RangeError(`Unsupported binary metric: ${metric}`);
  }
  if (typeof countsOf !== "function") {
    throw new TypeError("countsOf must be a function");
  }
  const totals = sumBinaryCounts(items, countsOf);
  const result = companyClusterBootstrapInterval(
    items,
    (sample) => binaryMetricFromCounts(sumBinaryCounts(sample, countsOf), metric),
    bootstrapOptions,
  );
  return { ...result, binaryMetric: metric, totals };
}
