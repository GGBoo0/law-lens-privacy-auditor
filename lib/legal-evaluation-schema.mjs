import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schema = JSON.parse(
  readFileSync(
    new URL("../data/legal-evaluation/evaluation.schema.json", import.meta.url),
    "utf8",
  ),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(schema);

const validators = new Map();

function validatorFor(definition) {
  if (!validators.has(definition)) {
    const validator = ajv.getSchema(`${schema.$id}#/$defs/${definition}`);
    if (!validator) throw new Error(`Unknown legal evaluation schema: ${definition}`);
    validators.set(definition, validator);
  }
  return validators.get(definition);
}

function formatErrors(errors) {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

export function assertLegalEvaluationContract(value, definition, label = definition) {
  const validate = validatorFor(definition);
  if (!validate(value)) {
    throw new Error(`Invalid ${label}: ${formatErrors(validate.errors)}`);
  }
  return value;
}

/**
 * JSON Schema validates shape; this validates relationships between fields so
 * a contradictory label cannot silently become expert ground truth.
 */
export function assertLegalEvaluationDecision(decision, label = "decision") {
  assertLegalEvaluationContract(decision, "decision", label);
  const errors = [];
  const supportingLegalBases = decision.legalBases.filter(
    (basis) => basis.fit === "direct" || basis.fit === "contextual",
  );
  const actionable = new Set([
    "possible_missing_disclosure",
    "ambiguity_or_inconsistency",
    "factual_verification",
  ]);

  if (decision.applicability === "notApplicable") {
    if (decision.severity !== "na") errors.push("notApplicable requires severity na");
    if (decision.defectCodes.length > 0) errors.push("notApplicable cannot have defect codes");
    if (decision.evidence.length > 0) errors.push("notApplicable cannot have evidence");
    if (decision.legalBases.length > 0) errors.push("notApplicable cannot have legal bases");
    if (decision.requiresFactualVerification) {
      errors.push("notApplicable cannot require factual verification");
    }
  }

  if (decision.goldLabel === "confirmed_disclosure") {
    if (decision.applicability !== "applicable") {
      errors.push("confirmed disclosure requires applicable status");
    }
    if (decision.severity !== "pass") errors.push("confirmed disclosure requires severity pass");
    if (decision.defectCodes.length > 0) {
      errors.push("confirmed disclosure cannot have defect codes");
    }
    if (decision.requiresFactualVerification) {
      errors.push("confirmed disclosure cannot require factual verification");
    }
  }

  if (
    actionable.has(decision.goldLabel) &&
    decision.applicability !== "notApplicable" &&
    ["pass", "na"].includes(decision.severity)
  ) {
    errors.push("an actionable finding requires low, medium, or high severity");
  }
  if (
    decision.goldLabel === "factual_verification" &&
    decision.requiresFactualVerification !== true
  ) {
    errors.push("factual verification label requires factual verification");
  }
  if (
    decision.goldLabel === "possible_missing_disclosure" &&
    decision.applicability === "applicable" &&
    !decision.evidence.some((item) => item?.kind === "absence_trace")
  ) {
    errors.push("possible missing disclosure requires an absence trace");
  }
  if (
    decision.applicability !== "notApplicable" &&
    actionable.has(decision.goldLabel) &&
    supportingLegalBases.length === 0
  ) {
    errors.push("an actionable finding requires at least one supporting legal basis");
  }
  if (
    decision.severity === "high" &&
    (decision.evidence.length === 0 || supportingLegalBases.length === 0)
  ) {
    errors.push("high severity requires evidence and a supporting legal basis");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid ${label}: ${errors.join("; ")}`);
  }
  return decision;
}

export function legalEvaluationSchema() {
  return structuredClone(schema);
}
