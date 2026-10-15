const MAX_DEPTH = 5;
const LOCAL_REF = /^#\/(\$defs|definitions)\/(.+)$/;

const FORMAT_LABELS = {
  date: 'Date',
  'date-time': 'Date and time',
  time: 'Time',
  email: 'Email',
  uri: 'Link',
  'uri-reference': 'Link',
};

const TYPE_LABELS = {
  string: 'Text',
  number: 'Number',
  integer: 'Whole number',
  boolean: 'Yes / No',
  object: 'Group',
  array: 'List',
};

const UNCOUNTABLE_LABELS = ['text', 'yes / no', 'any'];

const humanizeKey = (key) => key
  .replace(/([a-z\d])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (char) => char.toUpperCase());

const pluralize = (label) => {
  const lower = label.toLowerCase();
  return UNCOUNTABLE_LABELS.includes(lower) ? lower : `${lower}s`;
};

function resolveRef({ node, root, pointer }) {
  const match = node?.$ref?.match(LOCAL_REF);
  const target = match && root?.[match[1]]?.[match[2]];
  if (!target) return { node, pointer };
  return {
    node: { ...target, ...node, $ref: undefined },
    pointer: [match[1], match[2]],
    definition: target.title ?? match[2],
  };
}

function getTypeLabel(node) {
  if (node.enum) return 'Choice';
  if (node.$ref) return 'Reference';
  const type = Array.isArray(node.type) ? node.type.find((t) => t !== 'null') : node.type;
  if (type === 'string' && FORMAT_LABELS[node.format]) return FORMAT_LABELS[node.format];
  return TYPE_LABELS[type] ?? 'Any';
}

function getFieldType({ resolved, items, definition, itemsDefinition }) {
  if (resolved.type === 'array' && items) {
    return `List of ${itemsDefinition ? `${itemsDefinition}s` : pluralize(getTypeLabel(items))}`;
  }
  return definition ?? getTypeLabel(resolved);
}

function toField({
  key, node, required, root, depth, pointer, sharedIn,
}) {
  const { node: resolved, pointer: resolvedPointer, definition } = resolveRef({
    node, root, pointer,
  });
  const { node: items, pointer: itemsPointer, definition: itemsDefinition } = resolveRef({
    node: resolved.items, root, pointer: [...resolvedPointer, 'items'],
  });
  const isList = resolved.type === 'array';
  const children = depth < MAX_DEPTH ? toFields({ // eslint-disable-line no-use-before-define
    node: isList ? items : resolved,
    pointer: isList ? itemsPointer : resolvedPointer,
    root,
    depth: depth + 1,
    sharedIn: (isList ? itemsDefinition : definition) ?? sharedIn,
  }) : [];

  return {
    key,
    pointer,
    label: node.title ?? (definition ? humanizeKey(key) : resolved.title ?? key),
    description: resolved.description,
    type: getFieldType({
      resolved, items, definition, itemsDefinition,
    }),
    required: required.includes(key),
    options: resolved.enum,
    sharedIn,
    children,
  };
}

function toFields({
  node, root, pointer, sharedIn, depth = 0,
}) {
  const properties = node?.properties ?? {};
  const required = node?.required ?? [];
  return Object.entries(properties).map(([key, child]) => toField({
    key, node: child, required, root, depth, sharedIn, pointer: [...pointer, 'properties', key],
  }));
}

/**
 * Converts a JSON schema into a nested, author-friendly field list.
 * Each field carries the key path (`pointer`) to its definition in the source.
 */
export function toFieldTree(schema) {
  const { node, pointer } = resolveRef({ node: schema, root: schema, pointer: [] });
  return toFields({ node, root: schema, pointer });
}

export function countFields(fields) {
  return fields.reduce((total, field) => total + 1 + countFields(field.children), 0);
}
