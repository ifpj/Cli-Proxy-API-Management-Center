/**
 * 模型工具函数
 * 迁移自基线 utils/models.js
 */

export interface ModelInfo {
  name: string;
  alias?: string;
  description?: string;
  group?: string;
  groupLabel?: string;
}

const MODEL_CATEGORIES = [
  { id: 'gpt', label: 'GPT', patterns: [/gpt/i, /\bo\d\b/i, /\bo\d+\.?/i, /\bchatgpt/i] },
  { id: 'claude', label: 'Claude', patterns: [/claude/i] },
  { id: 'gemini', label: 'Gemini', patterns: [/gemini/i, /\bgai\b/i] },
  { id: 'kimi', label: 'Kimi', patterns: [/kimi/i] },
  { id: 'qwen', label: 'Qwen', patterns: [/qwen/i] },
  { id: 'glm', label: 'GLM', patterns: [/glm/i, /chatglm/i] },
  { id: 'grok', label: 'Grok', patterns: [/grok/i] },
  { id: 'deepseek', label: 'DeepSeek', patterns: [/deepseek/i] },
  { id: 'minimax', label: 'MiniMax', patterns: [/minimax/i, /abab/i] }
];

const matchCategory = (text: string) => {
  for (const category of MODEL_CATEGORIES) {
    if (category.patterns.some((pattern) => pattern.test(text))) {
      return category.id;
    }
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const compareModelsByName = (a: ModelInfo, b: ModelInfo) => {
  const nameCompare = a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: 'base'
  });
  if (nameCompare !== 0) return nameCompare;
  return (a.alias || '').localeCompare(b.alias || '', undefined, {
    numeric: true,
    sensitivity: 'base'
  });
};

export function normalizeModelList(payload: unknown, { dedupe = false } = {}): ModelInfo[] {
  const toModel = (entry: unknown, inheritedGroup?: string): ModelInfo | null => {
    if (typeof entry === 'string') {
      const model: ModelInfo = { name: entry };
      if (inheritedGroup) {
        model.group = inheritedGroup;
        model.groupLabel = inheritedGroup;
      }
      return model;
    }
    if (!isRecord(entry)) {
      return null;
    }
    const name = entry.id || entry.name || entry.model || entry.value;
    if (!name) return null;

    const alias = entry.alias || entry.display_name || entry.displayName;
    const description = entry.description || entry.note || entry.comment;
    const group = entry.group || entry.category || entry.provider || entry.type || inheritedGroup;
    const groupLabel = entry.groupLabel || entry.group_label || entry.categoryLabel || entry.category_label || group;
    const model: ModelInfo = { name: String(name) };
    if (alias && alias !== name) {
      model.alias = String(alias);
    }
    if (description) {
      model.description = String(description);
    }
    if (group) {
      model.group = String(group);
    }
    if (groupLabel) {
      model.groupLabel = String(groupLabel);
    }
    return model;
  };

  let models: (ModelInfo | null)[] = [];
  const fromGroupedRecord = (record: Record<string, unknown>) =>
    Object.entries(record).flatMap(([group, entries]) =>
      Array.isArray(entries) ? entries.map((entry) => toModel(entry, group)) : []
    );

  if (Array.isArray(payload)) {
    models = payload.map((entry) => toModel(entry));
  } else if (isRecord(payload)) {
    if (Array.isArray(payload.data)) {
      models = payload.data.map((entry) => toModel(entry));
    } else if (isRecord(payload.data)) {
      models = fromGroupedRecord(payload.data);
    } else if (Array.isArray(payload.models)) {
      models = payload.models.map((entry) => toModel(entry));
    } else if (isRecord(payload.models)) {
      models = fromGroupedRecord(payload.models);
    } else {
      models = fromGroupedRecord(payload);
    }
  }

  const normalized = models.filter(Boolean) as ModelInfo[];
  if (!dedupe) {
    return normalized;
  }

  const seen = new Set<string>();
  return normalized.filter((model) => {
    const key = (model?.name || '').toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export interface ModelGroup {
  id: string;
  label: string;
  items: ModelInfo[];
}

export function classifyModels(models: ModelInfo[] = [], { otherLabel = 'Other' } = {}): ModelGroup[] {
  const explicitGroups: ModelGroup[] = [];
  const explicitGroupMap = new Map<string, ModelGroup>();
  const groups: ModelGroup[] = MODEL_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    items: []
  }));

  const otherGroup: ModelGroup = { id: 'other', label: otherLabel, items: [] };

  models.forEach((model) => {
    const explicitGroup = model?.group?.trim();
    if (explicitGroup) {
      const key = explicitGroup.toLowerCase();
      const existing = explicitGroupMap.get(key);
      if (existing) {
        existing.items.push(model);
        return;
      }
      const nextGroup = {
        id: `group:${key}`,
        label: model.groupLabel?.trim() || explicitGroup,
        items: [model]
      };
      explicitGroupMap.set(key, nextGroup);
      explicitGroups.push(nextGroup);
      return;
    }

    const name = (model?.name || '').toString();
    const alias = (model?.alias || '').toString();
    const haystack = `${name} ${alias}`.toLowerCase();
    const matchedId = matchCategory(haystack);
    const target = matchedId ? groups.find((group) => group.id === matchedId) : null;

    if (target) {
      target.items.push(model);
    } else {
      otherGroup.items.push(model);
    }
  });

  const populatedGroups = groups.filter((group) => group.items.length > 0);
  if (explicitGroups.length) {
    populatedGroups.unshift(...explicitGroups);
  }
  if (otherGroup.items.length) {
    populatedGroups.push(otherGroup);
  }

  return populatedGroups.map((group) => ({
    ...group,
    items: [...group.items].sort(compareModelsByName)
  }));
}
