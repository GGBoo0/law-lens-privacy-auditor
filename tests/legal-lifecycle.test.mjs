import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LEGAL_BASELINE } from "../lib/legal-baseline.ts";
import {
  evaluateLegalRulesetFreshness,
  mergeRuntimeLegalChanges,
  normalizeLegalAsOfDate,
} from "../lib/legal-lifecycle.ts";
import {
  ALL_LEGAL_IMPACT_CATEGORIES,
  buildLegalRuntimeManifest,
  validateLegalRuleReviewRegistry,
  validateLegalRuntimeManifest,
} from "../lib/legal-runtime-manifest.ts";
import { analyzePrivacyPolicy } from "../lib/privacy-analyzer.ts";

const workflowCandidateManifestPath =
  process.env.LAW_LENS_CANDIDATE_RUNTIME_MANIFEST;

function baselineWithReviewedChange(changeId, reviewedAt = "2026-08-12") {
  return {
    ...LEGAL_BASELINE,
    upcomingChanges: LEGAL_BASELINE.upcomingChanges.map((change) =>
      change.changeId === changeId
        ? {
            ...change,
            review: {
              status: "reviewed",
              reviewedAt,
              reviewedRulesetVersion: LEGAL_BASELINE.rulesetVersion,
              outcome: "no_analyzer_impact",
            },
          }
        : change,
    ),
  };
}

test("reviewed staged rules keep the ruleset current until the next pending change", () => {
  const freshness = evaluateLegalRulesetFreshness("2026-08-19");

  assert.equal(freshness.status, "current_with_scheduled_review");
  assert.equal(freshness.validThrough, "2026-09-10");
  assert.equal(freshness.reviewRequiredBy, "2026-09-11");
  assert.equal(freshness.overdueLegalReview, false);
  assert.equal(freshness.warnings.length, 0);
  assert.equal(
    freshness.changes.find(
      (change) => change.changeId === "pipa-decree-36121-2026-08-20",
    )?.lifecycleStatus,
    "scheduled_reviewed",
  );
});

test("an unreviewed semantic change becomes overdue on its effective date and stays overdue", () => {
  for (const asOf of ["2026-09-11", "2026-09-12"]) {
    const freshness = evaluateLegalRulesetFreshness(asOf);

    assert.equal(freshness.status, "review_overdue", asOf);
    assert.equal(freshness.overdueLegalReview, true, asOf);
    assert.equal(
      freshness.effectiveUnreviewedChanges[0].changeId,
      "pipa-21445-2026-09-11",
      asOf,
    );
    assert.deepEqual(
      freshness.affectedCategoryKeys,
      ["privacy_officer", "security_measures"],
      asOf,
    );
    const pending = freshness.changes.find(
      (change) => change.changeId === "pipa-21445-2026-09-11",
    );
    assert.equal(
      pending?.lifecycleStatus,
      "effective_review_overdue",
      asOf,
    );
    assert.match(pending?.status ?? "", /시행됨.*판단 유보/, asOf);
    assert.match(pending?.baselineStatus ?? "", /시행 전/, asOf);
    assert.equal(freshness.warnings[0].safeHandling, "impacted_findings_deferred");
  }
});

test("the reviewed data-portability rule activates on 2026-08-20 without a global hold", () => {
  const policy =
    "개인정보 처리 목적은 회원관리입니다. 처리하는 개인정보 항목은 이름과 이메일입니다. 보유 기간은 탈퇴 시까지이며 전자파일은 복구할 수 없게 삭제합니다. 정보주체는 고객센터에서 열람, 정정·삭제, 처리정지와 동의철회를 요청할 수 있습니다. 개인정보 보호책임자는 privacy@example.com이며 접근권한 관리와 암호화를 적용합니다. 본 방침은 2026년 8월 1일부터 시행합니다.";

  const before = analyzePrivacyPolicy(policy, {
    legalAsOfDate: "2026-08-19",
    contextOverrides: { dataPortability: "yes" },
  });
  assert.equal(
    before.findings.some((finding) => finding.id === "data-portability-disclosure"),
    false,
  );

  const effective = analyzePrivacyPolicy(policy, {
    legalAsOfDate: "2026-08-20",
    contextOverrides: { dataPortability: "yes" },
  });
  const portability = effective.findings.find(
    (finding) => finding.id === "data-portability-disclosure",
  );

  assert.equal(effective.legalBaseline.overdueLegalReview, false);
  assert.equal(portability?.severity, "medium");
  assert.equal(portability?.findingType, "factual_verification");
  assert.equal(portability?.requiresFactualVerification, true);
  assert.equal(portability?.legalJudgmentStatus, undefined);
  assert.ok(effective.detectedSignals.includes("본인전송요구 · 사용자 확인"));

  const disclosed = analyzePrivacyPolicy(
    `${policy} 본인전송요구는 홈페이지 개인정보 메뉴에서 신청하고 개인정보를 직접 내려받을 수 있습니다.`,
    {
      legalAsOfDate: "2026-08-20",
      contextOverrides: { dataPortability: "yes" },
    },
  );
  assert.equal(
    disclosed.findings.some(
      (finding) => finding.id === "data-portability-disclosure",
    ),
    false,
  );
  assert.equal(
    disclosed.coverage.find((item) => item.label === "본인전송요구")?.state,
    "present",
  );

  const conflicting = analyzePrivacyPolicy(
    `${policy} 본인전송요구 적용 대상이 아닙니다. 다만 홈페이지에서 본인전송요구를 신청하고 개인정보를 내려받을 수 있습니다.`,
    { legalAsOfDate: "2026-08-20" },
  );
  assert.ok(
    conflicting.findings.some(
      (finding) => finding.id === "data-portability-context-conflict",
    ),
  );
});

test("a semantic review only counts when it names the active ruleset version", () => {
  const reviewedBaseline = baselineWithReviewedChange(
    "pipa-21445-2026-09-11",
  );
  const reviewed = evaluateLegalRulesetFreshness(
    "2026-09-11",
    reviewedBaseline,
  );

  assert.equal(reviewed.overdueLegalReview, false);
  assert.equal(reviewed.validThrough, "2027-02-19");
  assert.equal(reviewed.reviewRequiredBy, "2027-02-20");
  assert.equal(
    reviewed.changes.find(
      (change) => change.changeId === "pipa-21445-2026-09-11",
    )?.lifecycleStatus,
    "effective_reviewed",
  );

  const wrongVersionBaseline = {
    ...reviewedBaseline,
    upcomingChanges: reviewedBaseline.upcomingChanges.map((change) =>
      change.changeId === "pipa-21445-2026-09-11"
        ? {
            ...change,
            review: {
              ...change.review,
              reviewedRulesetVersion: "KR-PRIVACY-old-rules",
            },
          }
        : change,
    ),
  };
  const wrongVersion = evaluateLegalRulesetFreshness(
    "2026-09-11",
    wrongVersionBaseline,
  );
  assert.equal(wrongVersion.overdueLegalReview, true);
  assert.equal(
    wrongVersion.changes.find(
      (change) => change.changeId === "pipa-21445-2026-09-11",
    )?.lifecycleStatus,
    "effective_review_overdue",
  );
});

test("the analyzer defers an impacted legal conclusion instead of using a stale rule", () => {
  const policy =
    "개인정보 처리 목적은 회원관리입니다. 처리하는 개인정보 항목은 이름과 이메일입니다. 개인정보 처리 및 보유 기간은 회원 탈퇴 시까지입니다. 파기 절차와 방법에 따라 전자파일을 영구 삭제합니다. 정보주체는 열람, 정정, 삭제와 처리정지를 요청할 수 있습니다. 안전성 확보조치로 접근권한 관리와 암호화를 시행합니다. 본 방침은 2026년 8월 1일부터 시행합니다.";

  const before = analyzePrivacyPolicy(policy, {
    legalAsOfDate: "2026-09-10",
  });
  const beforeContact = before.findings.find(
    (finding) => finding.id === "missing-contact",
  );
  assert.equal(beforeContact?.severity, "high");
  assert.equal(beforeContact?.legalJudgmentStatus, undefined);

  const effective = analyzePrivacyPolicy(policy, {
    legalAsOfDate: "2026-09-11",
  });
  const effectiveContact = effective.findings.find(
    (finding) => finding.id === "missing-contact",
  );
  assert.equal(effectiveContact?.severity, "low");
  assert.equal(effectiveContact?.findingType, "factual_verification");
  assert.equal(effectiveContact?.requiresFactualVerification, true);
  assert.equal(
    effectiveContact?.legalJudgmentStatus,
    "deferred_pending_legal_review",
  );
  assert.equal(effectiveContact?.originalAssessment?.severity, "high");
  assert.deepEqual(effectiveContact?.legalReviewWarning?.changeIds, [
    "pipa-21445-2026-09-11",
  ]);
  assert.equal(effective.legalBaseline.overdueLegalReview, true);
  assert.equal(effective.legalReviewWarnings[0].code, "LEGAL_RULE_REVIEW_OVERDUE");
  assert.match(effective.headline, /판단을 유보/);
});

test("Korean calendar dates are deterministic at the UTC day boundary", () => {
  assert.equal(
    normalizeLegalAsOfDate(new Date("2026-08-12T15:00:00.000Z")),
    "2026-08-13",
  );
  assert.throws(() => normalizeLegalAsOfDate("2026-02-30"), /real calendar date/);
});

function runtimeSnapshot({ effectiveDate = "20260812", sourceId = "new-law" } = {}) {
  return {
    schemaVersion: 1,
    capturedAt: "2026-08-11T00:10:00.000Z",
    sourceCount: 1,
    sources: {
      [sourceId]: {
        id: sourceId,
        name: "새 개인정보 관련 법령",
        officialUrl: "https://law.go.kr/example",
        versions: [
          {
            id: "new-version:20260812",
            documentHash: "new-document-hash",
            state: "시행예정",
            effectiveDate,
            promulgationNumber: "99999",
          },
        ],
      },
    },
  };
}

function emptyRegistry() {
  return {
    schemaVersion: 1,
    rulesetVersion: LEGAL_BASELINE.rulesetVersion,
    reviewedAt: "2026-08-11",
    reviews: [],
  };
}

test("snapshot-registry comparison persists a pending version across no-change runs", () => {
  const snapshot = runtimeSnapshot();
  const registry = emptyRegistry();
  const discovered = buildLegalRuntimeManifest({
    snapshot,
    registry,
    generatedAt: "2026-08-11T01:00:00.000Z",
  });

  assert.equal(discovered.pendingCount, 1);
  assert.equal(discovered.effectivePendingCount, 0);
  assert.equal(discovered.nextReviewRequiredBy, "2026-08-12");
  assert.match(discovered.pendingChanges[0].status, /시행 예정/);
  assert.deepEqual(
    discovered.pendingChanges[0].impactCategories,
    ALL_LEGAL_IMPACT_CATEGORIES,
    "unknown sources must conservatively affect every legal category",
  );

  const noChangesNextDay = buildLegalRuntimeManifest({
    snapshot,
    registry,
    previousManifest: discovered,
    generatedAt: "2026-08-12T01:00:00.000Z",
    observedAt: "2026-08-12T00:59:00.000Z",
  });
  assert.equal(noChangesNextDay.pendingCount, 1);
  assert.equal(noChangesNextDay.effectivePendingCount, 1);
  assert.equal(
    noChangesNextDay.pendingChanges[0].firstObservedAt,
    discovered.pendingChanges[0].firstObservedAt,
  );
  assert.match(noChangesNextDay.pendingChanges[0].status, /판단 유보/);
  assert.equal(validateLegalRuntimeManifest(noChangesNextDay).valid, true);
});

test("runtime manifest defers on the effective date and a committed review releases it", () => {
  const snapshot = runtimeSnapshot();
  const pendingManifest = buildLegalRuntimeManifest({
    snapshot,
    registry: emptyRegistry(),
    generatedAt: "2026-08-12T01:00:00.000Z",
    observedAt: "2026-08-12T00:59:00.000Z",
  });
  const policy =
    "개인정보 항목은 이름과 이메일입니다. 보유 기간은 탈퇴 시까지입니다. 파기 방법은 전자파일 영구 삭제입니다. 정보주체는 열람과 삭제를 요청할 수 있고 보호책임자는 privacy@example.com입니다. 안전성 확보조치로 암호화를 적용합니다. 본 방침은 2026년 8월 1일부터 시행합니다.";
  const deferred = analyzePrivacyPolicy(policy, {
    legalAsOfDate: "2026-08-12",
    runtimeLegalManifest: pendingManifest,
  });
  const deferredPurpose = deferred.findings.find(
    (finding) => finding.id === "missing-purpose",
  );
  assert.equal(deferredPurpose?.severity, "low");
  assert.equal(
    deferredPurpose?.legalJudgmentStatus,
    "deferred_pending_legal_review",
  );
  assert.equal(deferred.legalBaseline.runtimeManifest.status, "valid");

  const reviewedRegistry = {
    ...emptyRegistry(),
    reviewedAt: "2026-08-12",
    reviews: [
      {
        sourceId: "new-law",
        versionId: "new-version:20260812",
        documentHash: "new-document-hash",
        effectiveDate: "2026-08-12",
        outcome: "rule_updated",
      },
    ],
  };
  const reviewedManifest = buildLegalRuntimeManifest({
    snapshot,
    registry: reviewedRegistry,
    previousManifest: pendingManifest,
    generatedAt: "2026-08-12T02:00:00.000Z",
    observedAt: "2026-08-12T01:59:00.000Z",
  });
  assert.equal(reviewedManifest.pendingCount, 0);

  const released = analyzePrivacyPolicy(policy, {
    legalAsOfDate: "2026-08-12",
    runtimeLegalManifest: reviewedManifest,
  });
  const releasedPurpose = released.findings.find(
    (finding) => finding.id === "missing-purpose",
  );
  assert.equal(releasedPurpose?.severity, "high");
  assert.equal(releasedPurpose?.legalJudgmentStatus, undefined);

  const replacedContentSnapshot = structuredClone(snapshot);
  replacedContentSnapshot.sources["new-law"].versions[0].documentHash =
    "silently-replaced-document-hash";
  const replacedContent = buildLegalRuntimeManifest({
    snapshot: replacedContentSnapshot,
    registry: reviewedRegistry,
    generatedAt: "2026-08-12T03:00:00.000Z",
    observedAt: "2026-08-12T02:59:00.000Z",
  });
  assert.equal(replacedContent.pendingCount, 1);
  assert.equal(
    replacedContent.pendingChanges[0].documentHash,
    "silently-replaced-document-hash",
  );
});

test(
  "the generated post-monitor candidate preserves an explicit review lifecycle",
  { skip: !workflowCandidateManifestPath },
  () => {
    const candidate = JSON.parse(
      readFileSync(workflowCandidateManifestPath, "utf8"),
    );
    const validation = validateLegalRuntimeManifest(candidate);
    assert.equal(validation.valid, true, validation.errors.join("; "));

    const asOfDate = normalizeLegalAsOfDate(candidate.generatedAt);
    const runtimeState = mergeRuntimeLegalChanges(
      candidate,
      candidate.generatedAt,
    );
    assert.equal(runtimeState.status, "valid");

    const freshness = evaluateLegalRulesetFreshness(asOfDate, {
      rulesetVersion: candidate.rulesetVersion,
      upcomingChanges: runtimeState.changes,
    });
    const effectivePending = candidate.pendingChanges.filter(
      (change) => change.effectiveFrom <= asOfDate,
    );
    assert.equal(candidate.effectivePendingCount, effectivePending.length);

    if (effectivePending.length > 0) {
      assert.equal(freshness.status, "review_overdue");
      assert.equal(freshness.overdueLegalReview, true);
      assert.equal(
        freshness.warnings[0]?.safeHandling,
        "impacted_findings_deferred",
      );
    } else {
      assert.equal(freshness.overdueLegalReview, false);
      assert.notEqual(freshness.status, "review_overdue");
    }
  },
);

test("semantic document hashes take precedence over transport hashes", () => {
  const snapshot = runtimeSnapshot();
  const version = snapshot.sources["new-law"].versions[0];
  version.semanticDocumentHash = "semantic-text-v1";
  const reviewedRegistry = {
    ...emptyRegistry(),
    reviews: [
      {
        sourceId: "new-law",
        versionId: "new-version:20260812",
        documentHash: "semantic-text-v1",
        effectiveDate: "2026-08-12",
        outcome: "rule_updated",
      },
    ],
  };

  assert.equal(
    buildLegalRuntimeManifest({
      snapshot,
      registry: reviewedRegistry,
      generatedAt: "2026-08-11T01:00:00.000Z",
    }).pendingCount,
    0,
  );

  version.documentHash = "transport-representation-changed";
  assert.equal(
    buildLegalRuntimeManifest({
      snapshot,
      registry: reviewedRegistry,
      generatedAt: "2026-08-11T02:00:00.000Z",
    }).pendingCount,
    0,
    "non-semantic API representation changes must not invalidate the review",
  );

  version.semanticDocumentHash = "semantic-text-v2";
  const changed = buildLegalRuntimeManifest({
    snapshot,
    registry: reviewedRegistry,
    generatedAt: "2026-08-11T03:00:00.000Z",
  });
  assert.equal(changed.pendingCount, 1);
  assert.equal(changed.pendingChanges[0].documentHash, "semantic-text-v2");
  assert.equal(
    changed.pendingChanges[0].hashAlgorithm,
    "legal-semantic-text-v1",
  );
});

test("a future staged effective date without its own version row stays pending", () => {
  const snapshot = runtimeSnapshot({ sourceId: "ecommerce-act" });
  const version = snapshot.sources["ecommerce-act"].versions[0];
  version.id = "282793:20260721";
  version.state = "현행";
  version.effectiveDate = "20260721";
  version.semanticDocumentHash = "ecommerce-semantic-v1";
  version.stageEffectiveDates = [
    { effectiveDate: "20260122", source: "appendix-explicit" },
    { effectiveDate: "20260721", source: "law-search" },
    { effectiveDate: "20270207", source: "appendix-explicit" },
  ];
  const registry = {
    ...emptyRegistry(),
    reviews: [
      {
        sourceId: "ecommerce-act",
        versionId: "282793:20260721",
        documentHash: "ecommerce-semantic-v1",
        effectiveDate: "2026-07-21",
        outcome: "rule_updated",
      },
    ],
  };

  const pending = buildLegalRuntimeManifest({
    snapshot,
    registry,
    generatedAt: "2026-08-11T01:00:00.000Z",
  });
  assert.equal(pending.pendingCount, 1);
  assert.equal(pending.pendingChanges[0].versionId, "282793:20270207");
  assert.equal(pending.pendingChanges[0].effectiveFrom, "2027-02-07");
  assert.deepEqual(pending.pendingChanges[0].impactCategories, [
    "ecommerce_retention",
  ]);

  const reviewed = buildLegalRuntimeManifest({
    snapshot,
    registry: {
      ...registry,
      reviews: [
        ...registry.reviews,
        {
          sourceId: "ecommerce-act",
          versionId: "282793:20270207",
          documentHash: "ecommerce-semantic-v1",
          effectiveDate: "2027-02-07",
          outcome: "no_analyzer_impact",
        },
      ],
    },
    previousManifest: pending,
    generatedAt: "2026-08-11T02:00:00.000Z",
  });
  assert.equal(reviewed.pendingCount, 0);
});

test("known sources use scoped impacts while malformed manifests fail closed", () => {
  const known = buildLegalRuntimeManifest({
    snapshot: runtimeSnapshot({ sourceId: "credit-information-act" }),
    registry: emptyRegistry(),
    generatedAt: "2026-08-11T01:00:00.000Z",
  });
  assert.deepEqual(known.pendingChanges[0].impactCategories, ["credit_information"]);

  const invalid = { ...known, pendingCount: 99 };
  assert.equal(validateLegalRuntimeManifest(invalid).valid, false);
  const conservative = mergeRuntimeLegalChanges(invalid, "2026-08-11");
  assert.equal(conservative.status, "invalid");
  assert.deepEqual(
    conservative.changes.at(-1).impactCategories,
    ALL_LEGAL_IMPACT_CATEGORIES,
  );
});

test("versionless official guidance is tracked by fingerprint and takes effect when first observed", () => {
  const snapshot = {
    capturedAt: "2026-08-11T15:30:00.000Z",
    sourceCount: 1,
    sources: {
      guide: {
        id: "pipc-privacy-policy-guideline",
        name: "개인정보 처리방침 작성지침",
        officialUrl: "https://www.pipc.go.kr/guide",
        fingerprint: "new-guideline-fingerprint",
      },
    },
  };
  const manifest = buildLegalRuntimeManifest({
    snapshot,
    registry: emptyRegistry(),
    generatedAt: "2026-08-11T15:31:00.000Z",
  });
  assert.equal(manifest.pendingCount, 1);
  assert.equal(manifest.effectivePendingCount, 1);
  assert.equal(manifest.pendingChanges[0].effectiveFrom, "2026-08-12");
  assert.equal(manifest.pendingChanges[0].effectiveDateUnknown, true);
  assert.equal(
    manifest.pendingChanges[0].versionId,
    "source-fingerprint:new-guideline-fingerprint",
  );
  assert.deepEqual(
    manifest.pendingChanges[0].impactCategories,
    ALL_LEGAL_IMPACT_CATEGORIES,
  );
});

test("a runtime manifest older than 36 hours fails closed", () => {
  const fresh = buildLegalRuntimeManifest({
    snapshot: runtimeSnapshot(),
    registry: emptyRegistry(),
    generatedAt: "2026-08-11T00:00:00.000Z",
  });
  const stale = mergeRuntimeLegalChanges(
    fresh,
    new Date("2026-08-12T12:00:01.000Z"),
  );
  assert.equal(stale.status, "stale");
  assert.deepEqual(
    stale.changes.at(-1).impactCategories,
    ALL_LEGAL_IMPACT_CATEGORIES,
  );

  const stillFresh = mergeRuntimeLegalChanges(
    fresh,
    new Date("2026-08-12T11:59:59.000Z"),
  );
  assert.equal(stillFresh.status, "valid");

  const noChangeRunWithOldStoredSnapshot = {
    ...fresh,
    generatedAt: "2026-08-12T12:00:00.000Z",
    snapshotCapturedAt: "2026-08-01T00:00:00.000Z",
  };
  assert.equal(
    mergeRuntimeLegalChanges(
      noChangeRunWithOldStoredSnapshot,
      new Date("2026-08-12T12:01:00.000Z"),
    ).status,
    "valid",
    "freshness follows the successful monitor run, not the unchanged stored snapshot",
  );
});

test("the committed registry validates and leaves only official future versions pending", () => {
  const registry = JSON.parse(
    readFileSync(
      new URL("../data/legal-rule-review-registry.json", import.meta.url),
      "utf8",
    ),
  );
  const snapshot = JSON.parse(
    readFileSync(
      new URL("../data/legal-source-snapshot.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(validateLegalRuleReviewRegistry(registry).valid, true);
  const manifest = buildLegalRuntimeManifest({
    snapshot,
    registry,
    generatedAt: "2026-08-11T01:00:00.000Z",
  });
  assert.equal(manifest.effectivePendingCount, 0);
  assert.equal(manifest.pendingCount, 3);
  assert.equal(
    manifest.pendingChanges.some(
      (change) => change.versionId === "283503:20260820",
    ),
    false,
    "the reviewed 2026-08-20 portability rule must leave the pending queue",
  );
  assert.ok(
    manifest.pendingChanges.some(
      (change) =>
        change.sourceId === "pipa-decree" &&
        change.versionId === "283503:20270220" &&
        change.effectiveFrom === "2027-02-20",
    ),
  );
  assert.equal(
    manifest.pendingChanges.some(
      (change) => change.versionId === "282793:20270207",
    ),
    false,
    "the reviewed cross-reference-only stage must not create an analyzer hold",
  );
});
