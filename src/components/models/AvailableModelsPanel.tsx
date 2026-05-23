import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { apiKeysApi } from '@/services/api/apiKeys';
import { useAuthStore, useConfigStore, useModelsStore, useThemeStore } from '@/stores';
import { classifyModels } from '@/utils/models';
import iconClaude from '@/assets/icons/claude.svg';
import iconDeepseek from '@/assets/icons/deepseek.svg';
import iconGemini from '@/assets/icons/gemini.svg';
import iconGlm from '@/assets/icons/glm.svg';
import iconGrok from '@/assets/icons/grok.svg';
import iconGrokDark from '@/assets/icons/grok-dark.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconMinimax from '@/assets/icons/minimax.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconQwen from '@/assets/icons/qwen.svg';
import styles from './AvailableModelsPanel.module.scss';

const MODEL_CATEGORY_ICONS: Record<string, string | { light: string; dark: string }> = {
  gpt: { light: iconOpenaiLight, dark: iconOpenaiDark },
  claude: iconClaude,
  gemini: iconGemini,
  qwen: iconQwen,
  kimi: { light: iconKimiLight, dark: iconKimiDark },
  glm: iconGlm,
  grok: { light: iconGrok, dark: iconGrokDark },
  deepseek: iconDeepseek,
  minimax: iconMinimax,
};

export function AvailableModelsPanel() {
  const { t, i18n } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const auth = useAuthStore();
  const config = useConfigStore((state) => state.config);
  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const modelsError = useModelsStore((state) => state.error);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

  const [modelStatus, setModelStatus] = useState<{
    type: 'success' | 'warning' | 'error' | 'muted';
    message: string;
  }>();

  const apiKeysCache = useRef<string[]>([]);

  const otherLabel = useMemo(
    () => (i18n.language?.toLowerCase().startsWith('zh') ? '\u5176\u4ed6' : 'Other'),
    [i18n.language]
  );
  const groupedModels = useMemo(() => classifyModels(models, { otherLabel }), [models, otherLabel]);

  const getIconForCategory = (categoryId: string): string | null => {
    const iconEntry = MODEL_CATEGORY_ICONS[categoryId];
    if (!iconEntry) return null;
    if (typeof iconEntry === 'string') return iconEntry;
    return resolvedTheme === 'dark' ? iconEntry.dark : iconEntry.light;
  };

  const normalizeApiKeyList = (input: unknown): string[] => {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const keys: string[] = [];

    input.forEach((item) => {
      const record =
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : null;
      const value =
        typeof item === 'string'
          ? item
          : record
            ? (record['api-key'] ?? record['apiKey'] ?? record.key ?? record.Key)
            : '';
      const trimmed = String(value ?? '').trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      keys.push(trimmed);
    });

    return keys;
  };

  const resolveApiKeysForModels = useCallback(async () => {
    if (apiKeysCache.current.length) {
      return apiKeysCache.current;
    }

    const configKeys = normalizeApiKeyList(config?.apiKeys);
    if (configKeys.length) {
      apiKeysCache.current = configKeys;
      return configKeys;
    }

    try {
      const list = await apiKeysApi.list();
      const normalized = normalizeApiKeyList(list);
      if (normalized.length) {
        apiKeysCache.current = normalized;
      }
      return normalized;
    } catch (err) {
      console.warn('Auto loading API keys for models failed:', err);
      return [];
    }
  }, [config?.apiKeys]);

  const fetchModels = useCallback(
    async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
      if (auth.connectionStatus !== 'connected') {
        setModelStatus({
          type: 'warning',
          message: t('notification.connection_required'),
        });
        return;
      }

      if (!auth.apiBase) {
        setModelStatus({
          type: 'warning',
          message: t('notification.connection_required'),
        });
        return;
      }

      if (forceRefresh) {
        apiKeysCache.current = [];
      }

      setModelStatus({ type: 'muted', message: t('system_info.models_loading') });
      try {
        const apiKeys = await resolveApiKeysForModels();
        const primaryKey = apiKeys[0];
        const list = await fetchModelsFromStore(auth.apiBase, primaryKey, forceRefresh);
        const hasModels = list.length > 0;
        setModelStatus({
          type: hasModels ? 'success' : 'warning',
          message: hasModels
            ? t('system_info.models_count', { count: list.length })
            : t('system_info.models_empty'),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
        const suffix = message ? `: ${message}` : '';
        const text = `${t('system_info.models_error')}${suffix}`;
        setModelStatus({ type: 'error', message: text });
      }
    },
    [
      auth.apiBase,
      auth.connectionStatus,
      fetchModelsFromStore,
      resolveApiKeysForModels,
      t,
    ]
  );

  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  return (
    <Card
      title={t('system_info.models_title')}
      extra={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void fetchModels({ forceRefresh: true })}
          loading={modelsLoading}
        >
          {t('common.refresh')}
        </Button>
      }
    >
      <p className={styles.sectionDescription}>{t('system_info.models_desc')}</p>
      {modelStatus && <div className={`status-badge ${modelStatus.type}`}>{modelStatus.message}</div>}
      {modelsError && <div className="error-box">{modelsError}</div>}
      {modelsLoading ? (
        <div className="hint">{t('common.loading')}</div>
      ) : models.length === 0 ? (
        <div className="hint">{t('system_info.models_empty')}</div>
      ) : (
        <div className="item-list">
          {groupedModels.map((group) => {
            const iconSrc = getIconForCategory(group.id);
            return (
              <div key={group.id} className="item-row">
                <div className="item-meta">
                  <div className={styles.groupTitle}>
                    {iconSrc && <img src={iconSrc} alt="" className={styles.groupIcon} />}
                    <span className="item-title">{group.label}</span>
                  </div>
                  <div className="item-subtitle">
                    {t('system_info.models_count', { count: group.items.length })}
                  </div>
                </div>
                <div className={styles.modelTags}>
                  {group.items.map((model) => (
                    <span
                      key={`${model.name}-${model.alias ?? 'default'}`}
                      className={styles.modelTag}
                      title={model.description || ''}
                    >
                      <span className={styles.modelName}>{model.name}</span>
                      {model.alias && <span className={styles.modelAlias}>{model.alias}</span>}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
