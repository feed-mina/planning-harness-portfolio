#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..");
const defaultSchemaPath = path.join(repoRoot, "app", "contracts", "ai-sdui.v1.schema.json");

function usage() {
  console.error("Usage: node validate_ai_sdui.mjs <candidate.json> [--schema <schema.json>]");
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} JSON read failed (${filePath}): ${error.message}`);
  }
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function resolveRef(rootSchema, ref) {
  if (!ref.startsWith("#/")) throw new Error(`Only local JSON Schema refs are supported: ${ref}`);
  return ref.slice(2).split("/").reduce((current, segment) => {
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!current || !Object.hasOwn(current, key)) throw new Error(`Unresolved JSON Schema ref: ${ref}`);
    return current[key];
  }, rootSchema);
}

function isDateTime(value) {
  if (typeof value !== "string") return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1] || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  if (match[7] !== "Z") {
    const offsetHour = Number(match[7].slice(1, 3));
    const offsetMinute = Number(match[7].slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function validateNode(value, schema, rootSchema, pointer = "$") {
  if (schema.$ref) return validateNode(value, resolveRef(rootSchema, schema.$ref), rootSchema, pointer);

  if (schema.oneOf) {
    const attempts = schema.oneOf.map((candidate) => validateNode(value, candidate, rootSchema, pointer));
    const passing = attempts.filter((errors) => errors.length === 0);
    if (passing.length === 1) return [];
    const closest = attempts.sort((a, b) => a.length - b.length)[0] || [];
    return [`${pointer}: expected exactly one schema branch (matched ${passing.length})`, ...closest.slice(0, 4)];
  }

  const errors = [];
  if (Object.hasOwn(schema, "const") && !sameValue(value, schema.const)) {
    errors.push(`${pointer}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((candidate) => sameValue(value, candidate))) {
    errors.push(`${pointer}: must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`);
  }

  if (schema.type) {
    const actual = jsonType(value);
    const matches = schema.type === "number"
      ? actual === "integer" || actual === "number"
      : schema.type === actual;
    if (!matches) return [...errors, `${pointer}: expected ${schema.type}, got ${actual}`];
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${pointer}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${pointer}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${pointer}: does not match ${schema.pattern}`);
    if (schema.format === "date-time" && !isDateTime(value)) errors.push(`${pointer}: invalid date-time`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${pointer}: needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${pointer}: exceeds ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, index) => errors.push(...validateNode(item, schema.items, rootSchema, `${pointer}[${index}]`)));
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) errors.push(`${pointer}.${required}: required`);
    }
    const properties = schema.properties || {};
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        errors.push(...validateNode(child, properties[key], rootSchema, `${pointer}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${pointer}.${key}: additional property is forbidden`);
      }
    }
  }
  return errors;
}

function semanticErrors(document) {
  const errors = [];
  if (!document || typeof document !== "object" || !document.card || typeof document.card !== "object") return errors;
  const ids = new Set();
  const visitId = (id, pointer) => {
    if (ids.has(id)) errors.push(`${pointer}: duplicate id ${id}`);
    ids.add(id);
  };
  const visitAction = (action, pointer) => visitId(action.id, `${pointer}.id`);

  visitId(document.card.id, "$.card.id");
  (document.card.actions || []).forEach((action, index) => visitAction(action, `$.card.actions[${index}]`));
  (document.card.children || []).forEach((component, index) => {
    const pointer = `$.card.children[${index}]`;
    visitId(component.id, `${pointer}.id`);
    (component.actions || []).forEach((action, actionIndex) => visitAction(action, `${pointer}.actions[${actionIndex}]`));
    if (component.type !== "approvalCard") return;
    const action = component.actions?.[0];
    for (const field of ["job_id", "operation", "payload_hash"]) {
      if (action?.[field] !== component.props?.[field]) errors.push(`${pointer}: ${field} must match APPROVE_JOB action`);
    }
  });
  return errors;
}

const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  usage();
  process.exit(args.includes("--help") ? 0 : 2);
}
const candidatePath = path.resolve(args[0]);
const schemaFlag = args.indexOf("--schema");
if (schemaFlag >= 0 && !args[schemaFlag + 1]) {
  usage();
  process.exit(2);
}
const schemaPath = schemaFlag >= 0 ? path.resolve(args[schemaFlag + 1]) : defaultSchemaPath;

try {
  const schema = readJson(schemaPath, "Schema");
  const candidate = readJson(candidatePath, "Candidate");
  const errors = [...validateNode(candidate, schema, schema), ...semanticErrors(candidate)];
  if (errors.length) {
    console.error(`REJECTED ${candidatePath}`);
    errors.slice(0, 30).forEach((error) => console.error(`- ${error}`));
    if (errors.length > 30) console.error(`- ... ${errors.length - 30} more`);
    process.exit(1);
  }
  console.log(`VALID planning-harness.ai-sdui.v1 ${candidatePath}`);
} catch (error) {
  console.error(`REJECTED ${candidatePath}`);
  console.error(`- ${error.message}`);
  process.exit(1);
}
