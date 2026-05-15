import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';
import {
  AmpcodeSection,
  ClaudeSection,
  CodexSection,
  GeminiSection,
  OpenAISection,
  VertexSection,
  ProviderNav,
  useProviderRecentRequests,
} from '@/components/providers';
import {
  buildCodexChatCompletionsEndpoint,
  buildGeminiGenerateContentEndpoint,
  buildOpenAIChatCompletionsEndpoint,
  DEFAULT_GEMINI_TEST_MODEL,
  withDisableAllModelsRule,
  withoutDisableAllModelsRule,
} from '@/components/providers/utils';
import { formatTestResponseBody, truncateTestResponse } from '@/components/providers/testResponseUtils';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { ampcodeApi, apiCallApi, getApiCallErrorMessage, providersApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore, useThemeStore } from '@/stores';
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import { buildHeaderObject, hasHeader } from '@/utils/headers';
import styles from './AiProvidersPage.module.scss';

const PROVIDER_TEST_TIMEOUT_MS = 30_000;

type ProviderBatchTestKind = 'gemini' | 'codex' | 'openai';

type ProviderBatchTestResult = {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string;
  responseStatusCode?: number;
  responseBodyText?: string;
  successMessage?: string;
  failureMessage?: string;
  successResponseBodyText?: string;
  failureResponseBodyText?: string;
};

type ActiveProviderTestDetail = {
  provider: ProviderBatchTestKind;
  index: number;
  group?: 'success' | 'failure';
};

export function AiProvidersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showNotification, showConfirmation } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);
  const isCacheValid = useConfigStore((state) => state.isCacheValid);

  const hasMounted = useRef(false);
  const [loading, setLoading] = useState(() => !isCacheValid());
  const [error, setError] = useState('');

  const [geminiKeys, setGeminiKeys] = useState<GeminiKeyConfig[]>(
    () => config?.geminiApiKeys || []
  );
  const [codexConfigs, setCodexConfigs] = useState<ProviderKeyConfig[]>(
    () => config?.codexApiKeys || []
  );
  const [claudeConfigs, setClaudeConfigs] = useState<ProviderKeyConfig[]>(
    () => config?.claudeApiKeys || []
  );
  const [vertexConfigs, setVertexConfigs] = useState<ProviderKeyConfig[]>(
    () => config?.vertexApiKeys || []
  );
  const [openaiProviders, setOpenaiProviders] = useState<OpenAIProviderConfig[]>(
    () => config?.openaiCompatibility || []
  );

  const [configSwitchingKey, setConfigSwitchingKey] = useState<string | null>(null);
  const [geminiTestResults, setGeminiTestResults] = useState<Record<number, ProviderBatchTestResult>>({});
  const [codexTestResults, setCodexTestResults] = useState<Record<number, ProviderBatchTestResult>>({});
  const [openaiTestResults, setOpenaiTestResults] = useState<Record<number, ProviderBatchTestResult>>({});
  const [testingProvider, setTestingProvider] = useState<ProviderBatchTestKind | null>(null);
  const [activeProviderTestDetail, setActiveProviderTestDetail] =
    useState<ActiveProviderTestDetail | null>(null);

  const disableControls = connectionStatus !== 'connected';
  const isSwitching = Boolean(configSwitchingKey);
  const isTestingGemini = testingProvider === 'gemini';
  const isTestingCodex = testingProvider === 'codex';
  const isTestingOpenAI = testingProvider === 'openai';

  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;

  const { usageByProvider, loadRecentRequests, refreshRecentRequests } = useProviderRecentRequests({
    enabled: isCurrentLayer,
  });

  const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return '';
  };

  const getProviderTestResultSetter = (provider: ProviderBatchTestKind) =>
    provider === 'gemini'
      ? setGeminiTestResults
      : provider === 'codex'
        ? setCodexTestResults
        : setOpenaiTestResults;

  const setProviderTestResult = (
    provider: ProviderBatchTestKind,
    index: number,
    result: ProviderBatchTestResult
  ) => {
    getProviderTestResultSetter(provider)((prev) => ({ ...prev, [index]: result }));
  };

  const getProviderTestResult = (provider: ProviderBatchTestKind, index: number) =>
    provider === 'gemini'
      ? geminiTestResults[index]
      : provider === 'codex'
        ? codexTestResults[index]
        : openaiTestResults[index];

  const loadConfigs = useCallback(async () => {
    const hasValidCache = isCacheValid();
    if (!hasValidCache) {
      setLoading(true);
    }
    setError('');
    try {
      const [configResult, vertexResult, ampcodeResult, openaiResult] = await Promise.allSettled([
        fetchConfig(),
        providersApi.getVertexConfigs(),
        ampcodeApi.getAmpcode(),
        providersApi.getOpenAIProviders(),
      ]);

      if (configResult.status !== 'fulfilled') {
        throw configResult.reason;
      }

      const data = configResult.value;
      setGeminiKeys(data?.geminiApiKeys || []);
      setCodexConfigs(data?.codexApiKeys || []);
      setClaudeConfigs(data?.claudeApiKeys || []);
      setVertexConfigs(data?.vertexApiKeys || []);
      setOpenaiProviders(data?.openaiCompatibility || []);

      if (vertexResult.status === 'fulfilled') {
        setVertexConfigs(vertexResult.value || []);
        updateConfigValue('vertex-api-key', vertexResult.value || []);
        clearCache('vertex-api-key');
      }

      if (ampcodeResult.status === 'fulfilled') {
        updateConfigValue('ampcode', ampcodeResult.value);
        clearCache('ampcode');
      }

      if (openaiResult.status === 'fulfilled') {
        setOpenaiProviders(openaiResult.value || []);
        updateConfigValue('openai-compatibility', openaiResult.value || []);
        clearCache('openai-compatibility');
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err) || t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [clearCache, fetchConfig, isCacheValid, t, updateConfigValue]);

  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;
    loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    if (!isCurrentLayer) return;
    void loadRecentRequests().catch(() => {});
  }, [isCurrentLayer, loadRecentRequests]);

  useEffect(() => {
    if (config?.geminiApiKeys) setGeminiKeys(config.geminiApiKeys);
    if (config?.codexApiKeys) setCodexConfigs(config.codexApiKeys);
    if (config?.claudeApiKeys) setClaudeConfigs(config.claudeApiKeys);
    if (config?.vertexApiKeys) setVertexConfigs(config.vertexApiKeys);
    if (config?.openaiCompatibility) setOpenaiProviders(config.openaiCompatibility);
  }, [
    config?.geminiApiKeys,
    config?.codexApiKeys,
    config?.claudeApiKeys,
    config?.vertexApiKeys,
    config?.openaiCompatibility,
  ]);

  useEffect(() => {
    setGeminiTestResults({});
    if (activeProviderTestDetail?.provider === 'gemini') {
      setActiveProviderTestDetail(null);
    }
  }, [geminiKeys]);

  useEffect(() => {
    setCodexTestResults({});
    if (activeProviderTestDetail?.provider === 'codex') {
      setActiveProviderTestDetail(null);
    }
  }, [codexConfigs]);

  useEffect(() => {
    setOpenaiTestResults({});
    if (activeProviderTestDetail?.provider === 'openai') {
      setActiveProviderTestDetail(null);
    }
  }, [openaiProviders]);

  const handleRecentRequestsRefresh = useCallback(async () => {
    await refreshRecentRequests();
  }, [refreshRecentRequests]);

  useHeaderRefresh(handleRecentRequestsRefresh, isCurrentLayer);

  const testProviderConfig = useCallback(
    async (
      provider: ProviderBatchTestKind,
      configItem: GeminiKeyConfig | ProviderKeyConfig,
      index: number
    ) => {
      setProviderTestResult(provider, index, {
        status: 'loading',
        message:
          provider === 'gemini'
            ? t('ai_providers.gemini_test_running')
            : t('ai_providers.codex_test_running'),
      });

      const modelName =
        configItem.models?.find((model) => model.name?.trim())?.name.trim() ||
        (provider === 'gemini' ? DEFAULT_GEMINI_TEST_MODEL : '');
      if (!modelName) {
        const message =
          provider === 'gemini'
            ? t('ai_providers.gemini_test_model_required')
            : t('ai_providers.codex_test_model_required');
        setProviderTestResult(provider, index, { status: 'error', message });
        return false;
      }

      const endpoint =
        provider === 'gemini'
          ? buildGeminiGenerateContentEndpoint(configItem.baseUrl ?? '', modelName)
          : buildCodexChatCompletionsEndpoint(configItem.baseUrl ?? '');
      if (!endpoint) {
        const message =
          provider === 'gemini'
            ? t('ai_providers.gemini_test_endpoint_invalid')
            : t('ai_providers.codex_test_endpoint_invalid');
        setProviderTestResult(provider, index, { status: 'error', message });
        return false;
      }

      const apiKey = configItem.apiKey.trim();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...buildHeaderObject(configItem.headers),
      };

      if (provider === 'gemini') {
        if (apiKey && !hasHeader(headers, 'x-goog-api-key')) {
          headers['x-goog-api-key'] = apiKey;
        }
        if (!apiKey && !hasHeader(headers, 'x-goog-api-key') && !hasHeader(headers, 'authorization')) {
          const message = t('ai_providers.gemini_test_key_required');
          setProviderTestResult(provider, index, { status: 'error', message });
          return false;
        }
      } else {
        if (apiKey && !hasHeader(headers, 'authorization')) {
          headers.Authorization = `Bearer ${apiKey}`;
        }
        if (!apiKey && !hasHeader(headers, 'authorization')) {
          const message = t('ai_providers.codex_test_key_required');
          setProviderTestResult(provider, index, { status: 'error', message });
          return false;
        }
      }

      try {
        const result = await apiCallApi.request(
          {
            authIndex: configItem.authIndex,
            method: 'POST',
            url: endpoint,
            header: headers,
            data: JSON.stringify(
              provider === 'gemini'
                ? {
                    contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
                    generationConfig: { maxOutputTokens: 8 },
                  }
                : {
                    model: modelName,
                    messages: [{ role: 'user', content: 'Hi' }],
                    stream: false,
                    max_completion_tokens: 8,
                  }
            ),
          },
          { timeout: PROVIDER_TEST_TIMEOUT_MS }
        );

        const responseBodyText = truncateTestResponse(formatTestResponseBody(result.body, result.bodyText));

        if (result.statusCode < 200 || result.statusCode >= 300) {
          const message = getApiCallErrorMessage(result);
          setProviderTestResult(provider, index, {
            status: 'error',
            message,
            responseStatusCode: result.statusCode,
            responseBodyText,
          });
          return false;
        }

        const message =
          provider === 'gemini'
            ? t('ai_providers.gemini_test_success')
            : t('ai_providers.codex_test_success');
        setProviderTestResult(provider, index, {
          status: 'success',
          message,
          responseStatusCode: result.statusCode,
          responseBodyText,
        });
        return true;
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        const errorCode =
          typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code?: string }).code)
            : '';
        const isTimeout = errorCode === 'ECONNABORTED' || message.toLowerCase().includes('timeout');
        const resolvedMessage = isTimeout
          ? t(
              provider === 'gemini'
                ? 'ai_providers.gemini_test_timeout'
                : 'ai_providers.codex_test_timeout',
              { seconds: PROVIDER_TEST_TIMEOUT_MS / 1000 }
            )
          : `${t(
              provider === 'gemini'
                ? 'ai_providers.gemini_test_failed'
                : 'ai_providers.codex_test_failed'
            )}: ${message || t('common.unknown_error')}`;
        setProviderTestResult(provider, index, { status: 'error', message: resolvedMessage });
        return false;
      }
    },
    [t]
  );

  const testAllProviderConfigs = useCallback(
    async (provider: ProviderBatchTestKind) => {
      if (testingProvider) return;

      const source = provider === 'gemini' ? geminiKeys : codexConfigs;
      const validIndexes = source
        .map((item, index) => (item.apiKey?.trim() ? index : -1))
        .filter((index) => index >= 0);

      if (!validIndexes.length) {
        const message =
          provider === 'gemini'
            ? t('ai_providers.gemini_test_key_required')
            : t('ai_providers.codex_test_key_required');
        showNotification(message, 'error');
        return;
      }

      setTestingProvider(provider);
      setActiveProviderTestDetail(null);
      getProviderTestResultSetter(provider)({});

      try {
        const results = await Promise.all(
          validIndexes.map((index) => testProviderConfig(provider, source[index], index))
        );
        const successCount = results.filter(Boolean).length;
        const failCount = validIndexes.length - successCount;
        const baseKey = provider === 'gemini' ? 'gemini' : 'codex';

        if (failCount === 0) {
          const message = t(`ai_providers.${baseKey}_test_all_success`, { count: successCount });
          showNotification(message, 'success');
        } else if (successCount === 0) {
          const message = t(`ai_providers.${baseKey}_test_all_failed`, { count: failCount });
          showNotification(message, 'error');
        } else {
          const message = t(`ai_providers.${baseKey}_test_all_partial`, {
            success: successCount,
            failed: failCount,
          });
          showNotification(message, 'warning');
        }
      } finally {
        setTestingProvider(null);
      }
    },
    [codexConfigs, geminiKeys, showNotification, t, testProviderConfig, testingProvider]
  );

  const requestOpenAIProviderKey = useCallback(
    async (
      provider: OpenAIProviderConfig,
      keyEntry: NonNullable<OpenAIProviderConfig['apiKeyEntries']>[number],
      modelName: string,
      useMaxCompletionTokens: boolean
    ) => {
      const customHeaders = buildHeaderObject({
        ...(provider.headers || {}),
        ...(keyEntry.headers || {}),
      });
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...customHeaders,
      };
      if (keyEntry.apiKey?.trim() && !hasHeader(headers, 'authorization')) {
        headers.Authorization = `Bearer ${keyEntry.apiKey.trim()}`;
      }
      return apiCallApi.request(
        {
          authIndex: keyEntry.authIndex,
          method: 'POST',
          url: buildOpenAIChatCompletionsEndpoint(provider.baseUrl),
          header: headers,
          data: JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: 'Hi' }],
            stream: false,
            ...(useMaxCompletionTokens
              ? { max_completion_tokens: 8 }
              : { max_tokens: 8 }),
          }),
        },
        { timeout: PROVIDER_TEST_TIMEOUT_MS }
      );
    },
    []
  );

  const testOpenAIProvider = useCallback(
    async (index: number) => {
      if (testingProvider) return;
      const provider = openaiProviders[index];
      if (!provider) return;

      const endpoint = buildOpenAIChatCompletionsEndpoint(provider.baseUrl);
      if (!endpoint) {
        const message = t('notification.openai_test_url_required');
        setProviderTestResult('openai', index, { status: 'error', message });
        showNotification(message, 'error');
        return;
      }

      const modelName =
        provider.testModel?.trim() ||
        provider.models?.find((model) => model.name?.trim())?.name.trim() ||
        '';
      if (!modelName) {
        const message = t('notification.openai_test_model_required');
        setProviderTestResult('openai', index, { status: 'error', message });
        showNotification(message, 'error');
        return;
      }

      const keyEntries = (provider.apiKeyEntries || []).filter((entry) => entry.apiKey?.trim());
      if (!keyEntries.length) {
        const message = t('notification.openai_test_key_required');
        setProviderTestResult('openai', index, { status: 'error', message });
        showNotification(message, 'error');
        return;
      }

      setTestingProvider('openai');
      setActiveProviderTestDetail(null);
      setProviderTestResult('openai', index, {
        status: 'loading',
        message: t('ai_providers.openai_test_running'),
      });

      try {
        const details = await Promise.all(
          keyEntries.map(async (entry, entryIndex) => {
            try {
              let result = await requestOpenAIProviderKey(provider, entry, modelName, false);
              let responseBodyText = truncateTestResponse(formatTestResponseBody(result.body, result.bodyText));
              const unsupportedMaxTokens =
                result.statusCode === 400 &&
                /max_tokens/i.test(`${responseBodyText} ${getApiCallErrorMessage(result)}`) &&
                /max_completion_tokens/i.test(`${responseBodyText} ${getApiCallErrorMessage(result)}`);
              if (unsupportedMaxTokens) {
                result = await requestOpenAIProviderKey(provider, entry, modelName, true);
                responseBodyText = truncateTestResponse(formatTestResponseBody(result.body, result.bodyText));
              }
              const ok = result.statusCode >= 200 && result.statusCode < 300;
              return {
                index: entryIndex + 1,
                ok,
                statusCode: result.statusCode,
                message: ok ? '' : getApiCallErrorMessage(result),
                body: responseBodyText,
              };
            } catch (err: unknown) {
              return {
                index: entryIndex + 1,
                ok: false,
                message: getErrorMessage(err) || t('common.unknown_error'),
                body: '',
              };
            }
          })
        );

        const successCount = details.filter((detail) => detail.ok).length;
        const failCount = details.length - successCount;
        const successDetails = details.filter((detail) => detail.ok);
        const failureDetails = details.filter((detail) => !detail.ok);
        const message =
          failCount === 0
            ? t('ai_providers.openai_test_all_success', { count: successCount })
            : successCount === 0
              ? t('ai_providers.openai_test_all_failed', { count: failCount })
              : t('ai_providers.openai_test_all_partial', {
                  success: successCount,
                  failed: failCount,
                });
        setProviderTestResult('openai', index, {
          status: failCount === 0 ? 'success' : 'error',
          message,
          responseBodyText: JSON.stringify(details, null, 2),
          successMessage:
            successCount > 0
              ? t('ai_providers.openai_test_success_count', {
                  defaultValue: 'Passed: {{count}}',
                  count: successCount,
                })
              : undefined,
          failureMessage:
            failCount > 0
              ? t('ai_providers.openai_test_failure_count', {
                  defaultValue: 'Failed: {{count}}',
                  count: failCount,
                })
              : undefined,
          successResponseBodyText: successCount
            ? JSON.stringify(successDetails, null, 2)
            : undefined,
          failureResponseBodyText: failCount
            ? JSON.stringify(failureDetails, null, 2)
            : undefined,
        });
        showNotification(message, failCount === 0 ? 'success' : successCount === 0 ? 'error' : 'warning');
      } finally {
        setTestingProvider(null);
      }
    },
    [openaiProviders, requestOpenAIProviderKey, showNotification, t, testingProvider]
  );

  const testSingleProviderConfig = useCallback(
    async (provider: ProviderBatchTestKind, index: number) => {
      if (testingProvider) return;
      const source = provider === 'gemini' ? geminiKeys : codexConfigs;
      const item = source[index];
      if (!item) return;

      setTestingProvider(provider);
      setActiveProviderTestDetail(null);
      try {
        const passed = await testProviderConfig(provider, item, index);
        if (passed) {
          showNotification(
            provider === 'gemini'
              ? t('ai_providers.gemini_test_success')
              : t('ai_providers.codex_test_success'),
            'success'
          );
        } else {
          showNotification(
            provider === 'gemini'
              ? t('ai_providers.gemini_test_failed')
              : t('ai_providers.codex_test_failed'),
            'error'
          );
        }
      } finally {
        setTestingProvider(null);
      }
    },
    [codexConfigs, geminiKeys, showNotification, t, testProviderConfig, testingProvider]
  );

  const openEditor = useCallback(
    (path: string) => {
      navigate(path, { state: { fromAiProviders: true } });
    },
    [navigate]
  );

  const deleteGemini = async (index: number) => {
    const entry = geminiKeys[index];
    if (!entry) return;
    showConfirmation({
      title: t('ai_providers.gemini_delete_title', { defaultValue: 'Delete Gemini Key' }),
      message: t('ai_providers.gemini_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          await providersApi.deleteGeminiKey(entry.apiKey, entry.baseUrl);
          const next = geminiKeys.filter((_, idx) => idx !== index);
          setGeminiKeys(next);
          updateConfigValue('gemini-api-key', next);
          clearCache('gemini-api-key');
          showNotification(t('notification.gemini_key_deleted'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  const setConfigEnabled = async (
    provider: 'gemini' | 'codex' | 'claude' | 'vertex',
    index: number,
    enabled: boolean
  ) => {
    if (provider === 'gemini') {
      const current = geminiKeys[index];
      if (!current) return;

      const switchingKey = `${provider}:${current.apiKey}`;
      setConfigSwitchingKey(switchingKey);

      const previousList = geminiKeys;
      const nextExcluded = enabled
        ? withoutDisableAllModelsRule(current.excludedModels)
        : withDisableAllModelsRule(current.excludedModels);
      const nextItem: GeminiKeyConfig = { ...current, excludedModels: nextExcluded };
      const nextList = previousList.map((item, idx) => (idx === index ? nextItem : item));

      setGeminiKeys(nextList);
      updateConfigValue('gemini-api-key', nextList);
      clearCache('gemini-api-key');

      try {
        await providersApi.saveGeminiKeys(nextList);
        showNotification(
          enabled ? t('notification.config_enabled') : t('notification.config_disabled'),
          'success'
        );
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        setGeminiKeys(previousList);
        updateConfigValue('gemini-api-key', previousList);
        clearCache('gemini-api-key');
        showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
      } finally {
        setConfigSwitchingKey(null);
      }
      return;
    }

    const source =
      provider === 'codex'
        ? codexConfigs
        : provider === 'claude'
          ? claudeConfigs
          : vertexConfigs;
    const current = source[index];
    if (!current) return;

    const switchingKey = `${provider}:${current.apiKey}`;
    setConfigSwitchingKey(switchingKey);

    const previousList = source;
    const nextExcluded = enabled
      ? withoutDisableAllModelsRule(current.excludedModels)
      : withDisableAllModelsRule(current.excludedModels);
    const nextItem: ProviderKeyConfig = { ...current, excludedModels: nextExcluded };
    const nextList = previousList.map((item, idx) => (idx === index ? nextItem : item));

    if (provider === 'codex') {
      setCodexConfigs(nextList);
      updateConfigValue('codex-api-key', nextList);
      clearCache('codex-api-key');
    } else if (provider === 'claude') {
      setClaudeConfigs(nextList);
      updateConfigValue('claude-api-key', nextList);
      clearCache('claude-api-key');
    } else {
      setVertexConfigs(nextList);
      updateConfigValue('vertex-api-key', nextList);
      clearCache('vertex-api-key');
    }

    try {
      if (provider === 'codex') {
        await providersApi.saveCodexConfigs(nextList);
      } else if (provider === 'claude') {
        await providersApi.saveClaudeConfigs(nextList);
      } else {
        await providersApi.saveVertexConfigs(nextList);
      }
      showNotification(
        enabled ? t('notification.config_enabled') : t('notification.config_disabled'),
        'success'
      );
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      if (provider === 'codex') {
        setCodexConfigs(previousList);
        updateConfigValue('codex-api-key', previousList);
        clearCache('codex-api-key');
      } else if (provider === 'claude') {
        setClaudeConfigs(previousList);
        updateConfigValue('claude-api-key', previousList);
        clearCache('claude-api-key');
      } else {
        setVertexConfigs(previousList);
        updateConfigValue('vertex-api-key', previousList);
        clearCache('vertex-api-key');
      }
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setConfigSwitchingKey(null);
    }
  };

  const setOpenAIProviderEnabled = async (index: number, enabled: boolean) => {
    const current = openaiProviders[index];
    if (!current) return;

    const switchingKey = `openai:${current.name}:${index}`;
    setConfigSwitchingKey(switchingKey);

    const previousList = openaiProviders;
    const nextItem: OpenAIProviderConfig = { ...current, disabled: !enabled };
    const nextList = previousList.map((item, idx) => (idx === index ? nextItem : item));

    setOpenaiProviders(nextList);
    updateConfigValue('openai-compatibility', nextList);
    clearCache('openai-compatibility');

    try {
      await providersApi.updateOpenAIProviderDisabled(index, !enabled);
      showNotification(
        enabled ? t('notification.config_enabled') : t('notification.config_disabled'),
        'success'
      );
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      setOpenaiProviders(previousList);
      updateConfigValue('openai-compatibility', previousList);
      clearCache('openai-compatibility');
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setConfigSwitchingKey(null);
    }
  };

  const deleteProviderEntry = async (type: 'codex' | 'claude', index: number) => {
    const source = type === 'codex' ? codexConfigs : claudeConfigs;
    const entry = source[index];
    if (!entry) return;
    showConfirmation({
      title: t(`ai_providers.${type}_delete_title`, { defaultValue: `Delete ${type === 'codex' ? 'Codex' : 'Claude'} Config` }),
      message: t(`ai_providers.${type}_delete_confirm`),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          if (type === 'codex') {
            await providersApi.deleteCodexConfig(entry.apiKey, entry.baseUrl);
            const next = codexConfigs.filter((_, idx) => idx !== index);
            setCodexConfigs(next);
            updateConfigValue('codex-api-key', next);
            clearCache('codex-api-key');
            showNotification(t('notification.codex_config_deleted'), 'success');
          } else {
            await providersApi.deleteClaudeConfig(entry.apiKey, entry.baseUrl);
            const next = claudeConfigs.filter((_, idx) => idx !== index);
            setClaudeConfigs(next);
            updateConfigValue('claude-api-key', next);
            clearCache('claude-api-key');
            showNotification(t('notification.claude_config_deleted'), 'success');
          }
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  const deleteVertex = async (index: number) => {
    const entry = vertexConfigs[index];
    if (!entry) return;
    showConfirmation({
      title: t('ai_providers.vertex_delete_title', { defaultValue: 'Delete Vertex Config' }),
      message: t('ai_providers.vertex_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          await providersApi.deleteVertexConfig(entry.apiKey, entry.baseUrl);
          const next = vertexConfigs.filter((_, idx) => idx !== index);
          setVertexConfigs(next);
          updateConfigValue('vertex-api-key', next);
          clearCache('vertex-api-key');
          showNotification(t('notification.vertex_config_deleted'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  const deleteOpenai = async (index: number) => {
    const entry = openaiProviders[index];
    if (!entry) return;
    showConfirmation({
      title: t('ai_providers.openai_delete_title', { defaultValue: 'Delete OpenAI Provider' }),
      message: t('ai_providers.openai_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          await providersApi.deleteOpenAIProvider(entry.name);
          const next = openaiProviders.filter((_, idx) => idx !== index);
          setOpenaiProviders(next);
          updateConfigValue('openai-compatibility', next);
          clearCache('openai-compatibility');
          showNotification(t('notification.openai_provider_deleted'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  const activeTestResult = activeProviderTestDetail
    ? getProviderTestResult(activeProviderTestDetail.provider, activeProviderTestDetail.index)
    : undefined;
  const activeOpenAIGroupedBody =
    activeProviderTestDetail?.provider === 'openai' && activeProviderTestDetail.group === 'success'
      ? activeTestResult?.successResponseBodyText
      : activeProviderTestDetail?.provider === 'openai' &&
          activeProviderTestDetail.group === 'failure'
        ? activeTestResult?.failureResponseBodyText
        : undefined;
  const activeTestResponseBody =
    activeOpenAIGroupedBody?.trim() ||
    activeTestResult?.responseBodyText?.trim() ||
    t('ai_providers.openai_test_no_response_body', { defaultValue: 'No response body' });
  const activeTestResponseMeta = activeTestResult?.responseStatusCode
    ? `HTTP ${activeTestResult.responseStatusCode}`
    : activeTestResult?.message || '';
  const activeTestTitle = activeProviderTestDetail
    ? activeProviderTestDetail.provider === 'openai' && activeProviderTestDetail.group === 'success'
      ? t('ai_providers.openai_test_success_title', {
          defaultValue: 'OpenAI Test Successes',
        })
      : activeProviderTestDetail.provider === 'openai' && activeProviderTestDetail.group === 'failure'
        ? t('ai_providers.openai_test_failure_title', {
            defaultValue: 'OpenAI Test Failures',
          })
        : t(
            activeProviderTestDetail.provider === 'gemini'
              ? 'ai_providers.gemini_test_title'
              : activeProviderTestDetail.provider === 'codex'
                ? 'ai_providers.codex_test_title'
                : 'ai_providers.openai_test_title'
          )
    : '';

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('ai_providers.title')}</h1>
      <div className={styles.content}>
        {error && <div className="error-box">{error}</div>}

        <div id="provider-gemini">
          <GeminiSection
            configs={geminiKeys}
            usageByProvider={usageByProvider}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            isTestingAll={isTestingGemini}
            testResults={geminiTestResults}
            onAdd={() => openEditor('/ai-providers/gemini/new')}
            onEdit={(index) => openEditor(`/ai-providers/gemini/${index}`)}
            onDelete={deleteGemini}
            onToggle={(index, enabled) => void setConfigEnabled('gemini', index, enabled)}
            onTestAll={() => void testAllProviderConfigs('gemini')}
            onTestOne={(index) => void testSingleProviderConfig('gemini', index)}
            onOpenTestResult={(index) => setActiveProviderTestDetail({ provider: 'gemini', index })}
          />
        </div>

        <div id="provider-codex">
          <CodexSection
            configs={codexConfigs}
            usageByProvider={usageByProvider}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            isTestingAll={isTestingCodex}
            testResults={codexTestResults}
            onAdd={() => openEditor('/ai-providers/codex/new')}
            onEdit={(index) => openEditor(`/ai-providers/codex/${index}`)}
            onDelete={(index) => void deleteProviderEntry('codex', index)}
            onToggle={(index, enabled) => void setConfigEnabled('codex', index, enabled)}
            onTestAll={() => void testAllProviderConfigs('codex')}
            onTestOne={(index) => void testSingleProviderConfig('codex', index)}
            onOpenTestResult={(index) => setActiveProviderTestDetail({ provider: 'codex', index })}
          />
        </div>

        <div id="provider-claude">
          <ClaudeSection
            configs={claudeConfigs}
            usageByProvider={usageByProvider}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onAdd={() => openEditor('/ai-providers/claude/new')}
            onEdit={(index) => openEditor(`/ai-providers/claude/${index}`)}
            onDelete={(index) => void deleteProviderEntry('claude', index)}
            onToggle={(index, enabled) => void setConfigEnabled('claude', index, enabled)}
          />
        </div>

        <div id="provider-vertex">
          <VertexSection
            configs={vertexConfigs}
            usageByProvider={usageByProvider}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onAdd={() => openEditor('/ai-providers/vertex/new')}
            onEdit={(index) => openEditor(`/ai-providers/vertex/${index}`)}
            onDelete={deleteVertex}
            onToggle={(index, enabled) => void setConfigEnabled('vertex', index, enabled)}
          />
        </div>

        <div id="provider-ampcode">
          <AmpcodeSection
            config={config?.ampcode}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onEdit={() => openEditor('/ai-providers/ampcode')}
          />
        </div>

        <div id="provider-openai">
          <OpenAISection
            configs={openaiProviders}
            usageByProvider={usageByProvider}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            resolvedTheme={resolvedTheme}
            isTestingProvider={isTestingOpenAI}
            testResults={openaiTestResults}
            onAdd={() => openEditor('/ai-providers/openai/new')}
            onEdit={(index) => openEditor(`/ai-providers/openai/${index}`)}
            onDelete={deleteOpenai}
            onToggle={(index, enabled) => void setOpenAIProviderEnabled(index, enabled)}
            onTest={(index) => void testOpenAIProvider(index)}
            onOpenTestResult={(index, group) =>
              setActiveProviderTestDetail({ provider: 'openai', index, group })
            }
          />
        </div>
      </div>

      <ProviderNav />
      <Modal
        open={Boolean(activeProviderTestDetail && activeTestResult)}
        onClose={() => setActiveProviderTestDetail(null)}
        title={activeTestTitle}
        width={760}
      >
        <div className={styles.keyTestResponseModal}>
          {activeTestResponseMeta && (
            <div className={styles.keyTestResponseMeta}>{activeTestResponseMeta}</div>
          )}
          {activeTestResult?.message && (
            <div className={styles.keyTestResponseMessage}>{activeTestResult.message}</div>
          )}
          <pre className={styles.keyTestResponseBody}>{activeTestResponseBody}</pre>
        </div>
      </Modal>
    </div>
  );
}
