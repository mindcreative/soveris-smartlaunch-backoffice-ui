import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import draftSchema from "./v1/product-content.schema.json";
import publishSchema from "./v1/product-content-publish.schema.json";
import formSchema from "./v1/form-profile.schema.json";
import type {
  Checkbox,
  Email,
  Form,
  Radio,
  Select,
  SoverisProductContentV1DraftSafeDocument,
  Text,
  Textarea,
} from "./v1/generated/product-content-v1";

export type Product = SoverisProductContentV1DraftSafeDocument;
export type FormField = Text | Email | Textarea | Select | Radio | Checkbox;
export type FieldProfile = "text" | "email" | "textarea" | "select" | "radio" | "checkbox";
export type ContractTarget = "draft" | "publish";

export interface ContractIssue {
  path: string;
  keyword: string;
  code: string;
}

export interface ContractResult {
  valid: boolean;
  errors: ContractIssue[];
  warnings: ContractIssue[];
}

const ajv = new Ajv2020({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  strict: true,
  useDefaults: false,
});
addFormats(ajv);
ajv.addSchema(formSchema);
ajv.addSchema(draftSchema);

const draftValidator = ajv.getSchema(draftSchema.$id) as ValidateFunction;
const publishValidator = ajv.compile(publishSchema);

function escapePointer(value: string): string {
  return value.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function schemaIssue(error: ErrorObject): ContractIssue {
  let path = error.instancePath;
  if (error.keyword === "required") {
    path += `/${escapePointer(String(error.params.missingProperty))}`;
  } else if (error.keyword === "additionalProperties") {
    path += `/${escapePointer(String(error.params.additionalProperty))}`;
  } else if (error.keyword === "propertyNames") {
    path = path.replace(/\/[^/]+$/u, "");
  }
  return { path, keyword: error.keyword, code: `schema_${error.keyword}` };
}

function normalizedSchemaIssues(errors: ErrorObject[] | null | undefined): ContractIssue[] {
  const priority: Record<string, number> = {
    maxItems: 0,
    maxProperties: 0,
    maxLength: 0,
    minItems: 0,
    minProperties: 0,
    minLength: 0,
    propertyNames: 0,
    additionalProperties: 1,
    const: 2,
    type: 2,
    format: 2,
    pattern: 2,
    required: 5,
    oneOf: 10,
  };
  return (errors ?? [])
    .map((error, index) => ({ issue: schemaIssue(error), index, priority: priority[error.keyword] ?? 3 }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ issue }) => issue);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function decodedUnsafe(value: string): boolean {
  if (/[\\\u0000-\u001f\u007f]/u.test(value) || value.trim() !== value) return true;
  try {
    return /[\\\u0000-\u001f\u007f]/u.test(decodeURIComponent(value));
  } catch {
    return true;
  }
}

function safeLink(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 2_048 || decodedUnsafe(value) || value.startsWith("//")) return false;
  if (value.startsWith("/")) return true;
  if (value.startsWith("#")) return value.length > 1;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function safeImage(value: unknown): boolean {
  return typeof value === "string"
    && value.length <= 2_048
    && value.startsWith("/")
    && !value.startsWith("//")
    && !decodedUnsafe(value);
}

function formPreflight(value: unknown): ContractIssue[] {
  const content = asRecord(value);
  const form = asRecord(content?.form);
  const schema = asRecord(form?.schema);
  const properties = asRecord(schema?.properties);
  if (!properties) return [];
  for (const [name, candidate] of Object.entries(properties)) {
    const field = asRecord(candidate);
    if (!field) continue;
    const path = `/form/schema/properties/${escapePointer(name)}`;
    if (field.type === "array" && field["ui:widget"] === "checkbox") {
      const items = asRecord(field.items);
      if (!Array.isArray(items?.enum)) return [{ path: `${path}/items/enum`, keyword: "required", code: "schema_required" }];
      if (field.uniqueItems !== true) return [{ path: `${path}/uniqueItems`, keyword: "const", code: "schema_const" }];
    }
  }
  return [];
}

function semanticIssues(content: Product, target: ContractTarget): ContractIssue[] {
  const errors: ContractIssue[] = [];
  const add = (path: string, keyword: string, code: string) => errors.push({ path, keyword, code });
  const links: Array<[string, unknown]> = [
    ["/hero/cta/href", content.hero.cta.href],
    ["/hero/secondaryCta/href", content.hero.secondaryCta?.href],
  ];
  content.footer?.forEach((section, sectionIndex) => section.links.forEach((link, linkIndex) => {
    links.push([`/footer/${sectionIndex}/links/${linkIndex}/href`, link.href]);
  }));
  links.forEach(([path, value]) => {
    if (value !== undefined && !safeLink(value)) add(path, "urlPolicy", "unsafe_url");
  });

  const images: Array<[string, unknown]> = [["/hero/backgroundImage/src", content.hero.backgroundImage.src]];
  content.features?.items.forEach((feature, index) => {
    images.push([`/features/items/${index}/image/src`, feature.image?.src]);
  });
  images.forEach(([path, value]) => {
    if (value !== undefined && !safeImage(value)) add(path, "urlPolicy", "unsafe_image_url");
  });

  const schema = content.form?.schema;
  if (schema) {
    const names = new Set(Object.keys(schema.properties));
    const orders = new Set<number>();
    for (const required of schema.required ?? []) {
      if (!names.has(required)) add("/form/schema/required", "requiredReference", "unknown_required_field");
    }
    for (const [name, field] of Object.entries(schema.properties)) {
      const path = `/form/schema/properties/${escapePointer(name)}`;
      if (orders.has(field.order)) add(`${path}/order`, "uniqueOrder", "duplicate_field_order");
      orders.add(field.order);
      if ("minLength" in field && field.minLength !== undefined && field.minLength > field.maxLength) {
        add(`${path}/minLength`, "range", "invalid_field_bounds");
      }
      if (field.type === "array") {
        if (field.minItems !== undefined && field.minItems > field.maxItems) add(`${path}/minItems`, "range", "invalid_field_bounds");
        if (field.maxItems > field.items.enum.length) add(`${path}/maxItems`, "range", "invalid_field_bounds");
      }
      const values = field.type === "array" ? field.items.enum : "enum" in field ? field.enum : undefined;
      const labels = "ui:enumLabels" in field ? field["ui:enumLabels"] : undefined;
      if (labels && values) {
        const keys = Object.keys(labels);
        if (keys.length !== values.length || keys.some((key) => !values.includes(key))) {
          add(`${path}/ui:enumLabels`, "enumReferences", "invalid_enum_labels");
        }
      }
      if (field.type === "array" && field["ui:exclusionGroups"]) {
        for (const [group, members] of Object.entries(field["ui:exclusionGroups"] ?? {})) {
          if (members.some((member) => !field.items.enum.includes(member))) {
            add(`${path}/ui:exclusionGroups/${escapePointer(group)}`, "enumReferences", "invalid_exclusion_group");
          }
        }
      }
    }
    if (target === "publish") {
      const emailFields = Object.entries(schema.properties)
        .filter(([, field]) => field.type === "string" && "format" in field && field.format === "email")
        .map(([name, field]) => ({ name, order: field.order }))
        .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
      if (emailFields.length === 0) {
        add("/form/schema/properties", "emailProfile", "publication_email_field_missing");
      } else if (emailFields.length > 1) {
        add(`/form/schema/properties/${escapePointer(emailFields[1].name)}`, "emailProfileCount", "publication_email_field_multiple");
      } else if (!new Set<string>(schema.required ?? []).has(emailFields[0].name)) {
        add("/form/schema/required", "requiredEmailProfile", "publication_email_field_optional");
      }
    }
  }
  return errors;
}

export function validateProductContent(value: unknown, target: ContractTarget = "publish", schemaVersion = 1): ContractResult {
  if (schemaVersion !== 1) {
    return { valid: false, errors: [{ path: "", keyword: "schemaVersion", code: "unsupported_schema_version" }], warnings: [] };
  }
  const preflight = formPreflight(value);
  if (preflight.length) return { valid: false, errors: preflight, warnings: [] };
  const validate = target === "publish" ? publishValidator : draftValidator;
  if (!validate(value)) {
    return { valid: false, errors: normalizedSchemaIssues(validate.errors), warnings: [] };
  }
  const content = value as Product;
  const errors = semanticIssues(content, target);
  const warnings: ContractIssue[] = [];
  if (target === "draft" && !content.form) warnings.push({ path: "/form", keyword: "quality", code: "publication_form_missing" });
  if (content.seo?.metaTitle && content.seo.metaTitle.length > 60) warnings.push({ path: "/seo/metaTitle", keyword: "quality", code: "seo_title_long" });
  if (content.seo?.metaDescription && content.seo.metaDescription.length > 160) warnings.push({ path: "/seo/metaDescription", keyword: "quality", code: "seo_description_long" });
  return { valid: errors.length === 0, errors, warnings };
}

export function isProductContent(value: unknown): value is Product {
  return validateProductContent(value, "publish").valid;
}

export function validateSubmissionData(data: Record<string, unknown>, form: Form): ContractResult {
  const errors: ContractIssue[] = [];
  const fields = form.schema.properties;
  for (const name of Object.keys(data)) {
    if (!(name in fields)) errors.push({ path: `/${escapePointer(name)}`, keyword: "additionalProperties", code: "unknown_submission_field" });
  }
  for (const name of form.schema.required ?? []) {
    const value = data[name];
    if (value === undefined || (typeof value === "string" && /^[\t\n\r ]*$/u.test(value)) || (Array.isArray(value) && value.length === 0)) {
      errors.push({ path: `/${escapePointer(name)}`, keyword: "required", code: "required_submission_field" });
    }
  }
  for (const [name, value] of Object.entries(data)) {
    const field = fields[name];
    if (!field) continue;
    const path = `/${escapePointer(name)}`;
    if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
      errors.push({ path, keyword: "nonEmpty", code: "empty_submission_value" });
    } else if (field.type === "string") {
      if (typeof value !== "string") errors.push({ path, keyword: "type", code: "submission_type" });
      else if ("format" in field && field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) errors.push({ path, keyword: "format", code: "submission_email" });
      else if ("enum" in field && !field.enum.includes(value)) errors.push({ path, keyword: "enum", code: "submission_enum" });
      else if ("maxLength" in field && (value.length < (field.minLength ?? 0) || value.length > field.maxLength)) errors.push({ path, keyword: "length", code: "submission_length" });
    } else if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      errors.push({ path, keyword: "type", code: "submission_type" });
    } else if (new Set(value).size !== value.length) {
      errors.push({ path, keyword: "uniqueItems", code: "submission_duplicate" });
    } else if (value.some((item) => !field.items.enum.includes(item))) {
      errors.push({ path, keyword: "enum", code: "submission_enum" });
    } else if (value.length < (field.minItems ?? 0) || value.length > field.maxItems) {
      errors.push({ path, keyword: "items", code: "submission_items" });
    } else {
      for (const members of Object.values(field["ui:exclusionGroups"] ?? {})) {
        if (value.filter((item) => members.includes(item)).length > 1) errors.push({ path, keyword: "exclusionGroup", code: "submission_exclusion" });
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function buildSubmissionData(values: Record<string, string | string[]>, form: Form): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const required = new Set(form.schema.required ?? []);
  for (const name of Object.keys(form.schema.properties)) {
    const value = values[name];
    if (value === undefined) continue;
    const empty = typeof value === "string" ? value === "" : value.length === 0;
    if (!empty || required.has(name)) data[name] = value;
  }
  return data;
}

export function fieldProfile(field: FormField): FieldProfile {
  if (field.type === "array") return "checkbox";
  if ("ui:widget" in field) return field["ui:widget"];
  if ("enum" in field) return "select";
  if ("format" in field) return "email";
  return "text";
}

export function orderedFormFields(form: Form): Array<[string, FormField]> {
  return Object.entries(form.schema.properties).sort(([, left], [, right]) => left.order - right.order);
}
