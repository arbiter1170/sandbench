// A tiny shape checker for the contracts. A field spec is
//   { type: "string" | "integer" | "boolean" | "object" | "timestamp" | "function",
//     required?, nullable?, enum?, pattern?, min?, max?, maxLength? }
// "timestamp" is an ISO 8601 string. Fields not in the spec are refused.

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function checkField(name, spec, value) {
  if (value === null) return spec.nullable ? null : `${name} can't be null`;
  switch (spec.type) {
    case "string":
      if (typeof value !== "string" || !value) return `${name} must be a non-empty string`;
      if (spec.maxLength && value.length > spec.maxLength) return `${name} is longer than ${spec.maxLength}`;
      if (spec.pattern && !spec.pattern.test(value)) return `${name} has characters that aren't allowed`;
      break;
    case "integer":
      if (!Number.isInteger(value)) return `${name} must be a whole number`;
      if (spec.min !== undefined && value < spec.min) return `${name} must be at least ${spec.min}`;
      if (spec.max !== undefined && value > spec.max) return `${name} must be at most ${spec.max}`;
      break;
    case "boolean":
      if (typeof value !== "boolean") return `${name} must be true or false`;
      break;
    case "object":
      if (!value || typeof value !== "object" || Array.isArray(value)) return `${name} must be an object`;
      break;
    case "timestamp":
      if (typeof value !== "string" || !ISO.test(value) || Number.isNaN(Date.parse(value))) return `${name} must be an ISO 8601 time`;
      break;
    case "function":
      if (typeof value !== "function") return `${name} must be a function`;
      break;
    default:
      return `${name} has an unknown type in its spec`;
  }
  if (spec.enum && !spec.enum.includes(value)) return `${name} must be one of ${spec.enum.join(", ")}`;
  return null;
}

export function validateShape(fields, value, label = "value") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, errors: [`${label} must be an object`] };
  const errors = [];
  for (const [name, spec] of Object.entries(fields)) {
    if (value[name] === undefined) {
      if (spec.required) errors.push(`${name} is required`);
      continue;
    }
    const error = checkField(name, spec, value[name]);
    if (error) errors.push(error);
  }
  for (const name of Object.keys(value)) {
    if (!Object.hasOwn(fields, name)) errors.push(`${name} is not a known field`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
