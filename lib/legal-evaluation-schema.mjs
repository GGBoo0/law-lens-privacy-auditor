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

export function legalEvaluationSchema() {
  return structuredClone(schema);
}
