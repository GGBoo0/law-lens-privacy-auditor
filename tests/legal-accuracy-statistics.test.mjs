import assert from "node:assert/strict";
import test from "node:test";

import {
  CLUSTER_BOOTSTRAP_METHOD_VERSION,
  SEEDED_PRNG_ALGORITHM,
  binaryMetricFromCounts,
  companyClusterBinaryInterval,
  companyClusterBootstrapInterval,
  createSeededPrng,
  wilson95Interval,
} from "../lib/legal-accuracy-statistics.mjs";

function approximately(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("Wilson 95% interval handles zero denominator and boundary proportions", () => {
  assert.deepEqual(wilson95Interval(0, 0), {
    status: "unavailable",
    reason: "zero_denominator",
    estimate: null,
    lower: null,
    upper: null,
    method: "wilson_score",
    confidenceLevel: 0.95,
    successes: 0,
    total: 0,
  });

  const none = wilson95Interval(0, 10);
  assert.equal(none.status, "ok");
  assert.equal(none.estimate, 0);
  assert.equal(none.lower, 0);
  approximately(none.upper, 0.2775327998628892);

  const all = wilson95Interval(10, 10);
  assert.equal(all.status, "ok");
  approximately(all.lower, 0.7224672001371107);
  assert.equal(all.upper, 1);

  const half = wilson95Interval(5, 10);
  approximately(half.lower, 0.236593090512564);
  approximately(half.upper, 0.7634069094874361);
});

test("Wilson interval rejects impossible or imprecise count inputs", () => {
  assert.throws(() => wilson95Interval(-1, 10), /non-negative safe integer/);
  assert.throws(() => wilson95Interval(2.5, 10), /non-negative safe integer/);
  assert.throws(() => wilson95Interval(11, 10), /must not exceed total/);
});

test("seeded PRNG is reproducible and its algorithm is pinned", () => {
  const first = createSeededPrng("accuracy-seed");
  const second = createSeededPrng("accuracy-seed");
  const other = createSeededPrng("other-seed");
  const values = Array.from({ length: 5 }, () => first());
  assert.deepEqual(values, Array.from({ length: 5 }, () => second()));
  assert.notDeepEqual(
    values,
    Array.from({ length: 5 }, () => other()),
  );
  assert.deepEqual(values, [
    0.7088555246591568,
    0.80150171299465,
    0.08625085046514869,
    0.3846515188924968,
    0.746193387079984,
  ]);
});

test("company bootstrap resamples whole clusters and is reproducible", () => {
  const items = [
    { companyId: "large", value: 1 },
    { companyId: "large", value: 1 },
    { companyId: "large", value: 1 },
    { companyId: "large", value: 1 },
    { companyId: "small", value: 0 },
  ];
  const observations = [];
  const metric = (sample, context) => {
    if (context.phase === "replicate") {
      observations.push({
        ids: context.sampledClusterIds,
        values: sample.map((item) => item.value),
      });
    }
    return sample.reduce((sum, item) => sum + item.value, 0) / sample.length;
  };
  const options = {
    seed: "cluster-fixture",
    replicates: 40,
    minimumClusters: 2,
    minimumReplicates: 40,
    includeDistribution: true,
  };
  const first = companyClusterBootstrapInterval(items, metric, options);
  const second = companyClusterBootstrapInterval(
    items,
    (sample) => sample.reduce((sum, item) => sum + item.value, 0) / sample.length,
    options,
  );

  assert.equal(first.status, "ok");
  assert.equal(first.methodVersion, CLUSTER_BOOTSTRAP_METHOD_VERSION);
  assert.equal(first.seedAlgorithm, SEEDED_PRNG_ALGORITHM);
  assert.equal(first.requiredValidReplicates, 40);
  assert.deepEqual(first.distribution, second.distribution);
  assert.equal(first.lower, second.lower);
  assert.equal(first.upper, second.upper);
  const tail = 0.025;
  const quantile = (values, probability) => {
    const position = (values.length - 1) * probability;
    const lowerIndex = Math.floor(position);
    const weight = position - lowerIndex;
    return (
      values[lowerIndex] +
      weight *
        (values[Math.min(lowerIndex + 1, values.length - 1)] -
          values[lowerIndex])
    );
  };
  approximately(first.lower, quantile(first.distribution, tail));
  approximately(first.upper, quantile(first.distribution, 1 - tail));
  assert.equal(observations.length, 40);
  assert.ok(
    observations.every(({ ids }) => ids.length === 2),
    "every replicate must draw exactly the observed number of companies",
  );
  assert.ok(
    observations.some(({ ids }) => ids[0] === ids[1]),
    "sampling must be with replacement",
  );
  assert.ok(
    observations.every(({ ids, values }) => {
      const expectedLength = ids.reduce(
        (sum, id) => sum + (id === "large" ? 4 : 1),
        0,
      );
      return values.length === expectedLength;
    }),
    "a selected company must contribute all of its rows",
  );
  assert.ok(
    first.distribution.every((value) => [0, 0.8, 1].includes(value)),
    "cluster resampling must not create item-level mean values",
  );
});

test("bootstrap guards cluster and valid replicate support", () => {
  const empty = companyClusterBootstrapInterval([], () => 0);
  assert.equal(empty.status, "unavailable");
  assert.equal(empty.reason, "no_observations");

  const oneCompany = companyClusterBootstrapInterval(
    [{ companyId: "only", value: 1 }],
    (sample) => sample[0].value,
  );
  assert.equal(oneCompany.status, "unavailable");
  assert.equal(oneCompany.reason, "insufficient_clusters");
  assert.equal(oneCompany.estimate, 1);

  const tooFewRequested = companyClusterBootstrapInterval(
    [
      { companyId: "a", value: 0 },
      { companyId: "b", value: 1 },
    ],
    (sample) => sample.reduce((sum, item) => sum + item.value, 0) / sample.length,
    { minimumClusters: 2, replicates: 9, minimumReplicates: 10 },
  );
  assert.equal(tooFewRequested.reason, "insufficient_requested_replicates");

  const tooFewValid = companyClusterBootstrapInterval(
    [
      { companyId: "a", value: 0 },
      { companyId: "b", value: 1 },
    ],
    (sample, context) =>
      context.phase === "point" || context.replicateIndex < 5 ? 0.5 : null,
    {
      minimumClusters: 2,
      replicates: 10,
      minimumReplicates: 10,
      includeDistribution: true,
    },
  );
  assert.equal(tooFewValid.reason, "insufficient_valid_replicates");
  assert.equal(tooFewValid.validReplicates, 5);
  assert.deepEqual(tooFewValid.distribution, [0.5, 0.5, 0.5, 0.5, 0.5]);

  const ninetyEightPercentValid = companyClusterBootstrapInterval(
    [
      { companyId: "a", value: 0 },
      { companyId: "b", value: 1 },
    ],
    (sample, context) =>
      context.phase === "point" || context.replicateIndex < 98
        ? sample.reduce((sum, item) => sum + item.value, 0) / sample.length
        : null,
    {
      minimumClusters: 2,
      replicates: 100,
      minimumReplicates: 2,
      minimumValidFraction: 0.99,
    },
  );
  assert.equal(ninetyEightPercentValid.status, "unavailable");
  assert.equal(ninetyEightPercentValid.reason, "insufficient_valid_replicates");
  assert.equal(ninetyEightPercentValid.validReplicates, 98);
  assert.equal(ninetyEightPercentValid.requiredValidReplicates, 99);
});

test("company and row ordering do not change a seeded bootstrap interval", () => {
  const rows = [
    { companyId: "zeta", value: 4 },
    { companyId: "alpha", value: 1 },
    { companyId: "middle", value: 3 },
    { companyId: "alpha", value: 2 },
    { companyId: "zeta", value: 5 },
  ];
  const shuffled = [rows[4], rows[3], rows[2], rows[1], rows[0]];
  const metric = (sample) =>
    sample.reduce((sum, item) => sum + item.value, 0) / sample.length;
  const options = {
    seed: "order-invariant-fixture",
    replicates: 100,
    minimumClusters: 3,
    minimumReplicates: 100,
    includeDistribution: true,
  };

  const original = companyClusterBootstrapInterval(rows, metric, options);
  const reordered = companyClusterBootstrapInterval(shuffled, metric, options);
  assert.equal(original.status, "ok");
  assert.equal(reordered.status, "ok");
  assert.equal(original.estimate, reordered.estimate);
  assert.equal(original.lower, reordered.lower);
  assert.equal(original.upper, reordered.upper);
  assert.deepEqual(original.distribution, reordered.distribution);
});

test("company cluster ids must be non-empty strings", () => {
  const options = {
    minimumClusters: 2,
    replicates: 10,
    minimumReplicates: 10,
  };
  assert.throws(
    () =>
      companyClusterBootstrapInterval(
        [{ companyId: 1, value: 1 }, { companyId: "two", value: 2 }],
        () => 1,
        options,
      ),
    /non-empty string/,
  );
  assert.throws(
    () =>
      companyClusterBootstrapInterval(
        [{ companyId: "   ", value: 1 }, { companyId: "two", value: 2 }],
        () => 1,
        options,
      ),
    /non-empty string/,
  );
});

test("constant and non-estimable bootstrap metrics are handled explicitly", () => {
  const constant = companyClusterBootstrapInterval(
    [
      { companyId: "a" },
      { companyId: "b" },
      { companyId: "c" },
    ],
    () => 1,
    { minimumClusters: 2, replicates: 20, minimumReplicates: 20 },
  );
  assert.equal(constant.status, "ok");
  assert.equal(constant.lower, 1);
  assert.equal(constant.upper, 1);

  const notEstimable = companyClusterBootstrapInterval(
    [{ companyId: "a" }, { companyId: "b" }],
    () => null,
    { minimumClusters: 2 },
  );
  assert.equal(notEstimable.status, "unavailable");
  assert.equal(notEstimable.reason, "non_finite_point_estimate");
});

test("clustered binary wrapper computes F1 and retains company dependence", () => {
  const clusteredCounts = [
    { companyId: "a", tp: 8, fp: 2, fn: 0, tn: 10 },
    { companyId: "b", tp: 0, fp: 0, fn: 8, tn: 10 },
    { companyId: "c", tp: 4, fp: 1, fn: 4, tn: 10 },
  ];
  const result = companyClusterBinaryInterval(clusteredCounts, {
    metric: "f1",
    seed: "binary-fixture",
    replicates: 100,
    minimumClusters: 3,
    minimumReplicates: 100,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.binaryMetric, "f1");
  assert.deepEqual(result.totals, { tp: 12, fp: 3, fn: 12, tn: 30 });
  approximately(result.estimate, 24 / 39);
  assert.ok(result.lower <= result.estimate);
  assert.ok(result.upper >= result.estimate);

  assert.equal(binaryMetricFromCounts({ tp: 0, fp: 0, fn: 0, tn: 3 }), null);
  assert.equal(
    binaryMetricFromCounts(
      { tp: 0, fp: 0, fn: 0, tn: 3 },
      "accuracy",
    ),
    1,
  );
});
