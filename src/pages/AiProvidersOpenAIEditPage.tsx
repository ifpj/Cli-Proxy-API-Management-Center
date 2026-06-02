import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { HeaderInputList } from '@/components/ui/HeaderInputList';
import { Input } from '@/components/ui/Input';
import { ModelInputList } from '@/components/ui/ModelInputList';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { SecondaryScreenShell } from '@/components/common/SecondaryScreenShell';
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack';
import { useNotificationStore } from '@/stores';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import type { ApiKeyEntry } from '@/types';
import { copyToClipboard } from '@/utils/clipboard';
import { buildHeaderObject, hasHeader } from '@/utils/headers';
import { buildApiKeyEntry, buildOpenAIChatCompletionsEndpoint } from '@/components/providers/utils';
import type { OpenAIEditOutletContext } from './AiProvidersOpenAIEditLayout';
import type { KeyTestStatus } from '@/stores/useOpenAIEditDraftStore';
import styles from './AiProvidersPage.module.scss';
import layoutStyles from './AiProvidersEditLayout.module.scss';

const OPENAI_TEST_TIMEOUT_MS = 30_000;
const TEST_RESPONSE_PREVIEW_MAX_LENGTH = 8_000;

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

const formatTestResponseBody = (body: unknown, bodyText: string): string => {
  if (body !== null && typeof body === 'object') {
    try {
      return JSON.stringify(body, null, 2);
    } catch {
      return bodyText;
    }
  }
  return bodyText;
};

const truncateTestResponse = (text: string): string => {
  if (text.length <= TEST_RESPONSE_PREVIEW_MAX_LENGTH) return text;
  return `${text.slice(0, TEST_RESPONSE_PREVIEW_MAX_LENGTH)}\n...`;
};

// Status icon components
function StatusLoadingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={styles.statusIconSpin}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M8 1A7 7 0 0 1 8 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function StatusSuccessIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="8" fill="var(--success-color, #22c55e)" />
      <path
        d="M4.5 8L7 10.5L11.5 6"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="8" fill="var(--danger-color, #c65746)" />
      <path
        d="M5 5L11 11M11 5L5 11"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusIdleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="var(--text-tertiary, #9ca3af)" strokeWidth="2" />
    </svg>
  );
}

function StatusIcon({ status }: { status: KeyTestStatus['status'] }) {
  switch (status) {
    case 'loading':
      return <StatusLoadingIcon />;
    case 'success':
      return <StatusSuccessIcon />;
    case 'error':
      return <StatusErrorIcon />;
    default:
      return <StatusIdleIcon />;
  }
}

const parseBulkApiKeysText = (text: string) =>
  text
    .split(/[\s,;]+/g)
    .map((key) => key.trim())
    .filter((key) => key && !/^https?:\/\//i.test(key));

const buildIdleKeyTestStatus = (): KeyTestStatus => ({ status: 'idle', message: '' });

const getKeyReorderRank = (entry: ApiKeyEntry, status: KeyTestStatus) => {
  if (!entry.apiKey?.trim()) return 2;
  if (status.status === 'success') return 0;
  if (status.status === 'error') return 2;
  return 1;
};

const isEditablePasteTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
};

export function AiProvidersOpenAIEditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showNotification } = useNotificationStore();
  const {
    hasIndexParam,
    invalidIndexParam,
    invalidIndex,
    disableControls,
    loading,
    saving,
    form,
    setForm,
    testModel,
    setTestModel,
    testStatus,
    setTestStatus,
    testMessage,
    setTestMessage,
    keyTestStatuses,
    pasteProxyUrl,
    setPasteProxyUrl,
    setDraftKeyTestStatus,
    removeDraftKeyTestStatus,
    resetDraftKeyTestStatuses,
    availableModels,
    pendingImportedKeyScrollIndex,
    consumeImportedKeyScrollIndex,
    handleBack,
    handleSave,
  } = useOutletContext<OpenAIEditOutletContext>();

  const title = hasIndexParam
    ? t('ai_providers.openai_edit_modal_title')
    : t('ai_providers.openai_add_modal_title');

  const swipeRef = useEdgeSwipeBack({ onBack: handleBack });
  const [isTestingKeys, setIsTestingKeys] = useState(false);
  const [isReorderingKeys, setIsReorderingKeys] = useState(false);
  const [activeTestDetailIndex, setActiveTestDetailIndex] = useState<number | null>(null);
  const [bulkKeysOpen, setBulkKeysOpen] = useState(false);
  const [bulkKeysText, setBulkKeysText] = useState('');
  const [pendingScrollKeyIndex, setPendingScrollKeyIndex] = useState<number | null>(null);
  const keyRowRefs = useRef(new Map<number, HTMLDivElement>());
  const pendingScrollDelayMsRef = useRef(0);

  const queueKeyRowScroll = useCallback((index: number, delayMs = 0) => {
    pendingScrollDelayMsRef.current = delayMs;
    setPendingScrollKeyIndex(index);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBack]);

  useEffect(() => {
    if (pendingScrollKeyIndex === null) return;
    let cancelled = false;
    let animationFrameId: number | null = null;
    let timeoutId: number | null = null;

    const scrollToRow = (attempt = 0) => {
      if (cancelled) return;
      const row = keyRowRefs.current.get(pendingScrollKeyIndex);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        pendingScrollDelayMsRef.current = 0;
        setPendingScrollKeyIndex(null);
        return;
      }
      if (attempt < 3) {
        timeoutId = window.setTimeout(() => scrollToRow(attempt + 1), 50);
      }
    };

    const startScroll = () => {
      animationFrameId = requestAnimationFrame(() => scrollToRow());
    };

    const delayMs = pendingScrollDelayMsRef.current;
    if (delayMs > 0) {
      timeoutId = window.setTimeout(startScroll, delayMs);
    } else {
      startScroll();
    }

    return () => {
      cancelled = true;
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [form.apiKeyEntries.length, pendingScrollKeyIndex]);

  useEffect(() => {
    if (pendingImportedKeyScrollIndex === null) return;
    queueKeyRowScroll(pendingImportedKeyScrollIndex);
    consumeImportedKeyScrollIndex();
  }, [consumeImportedKeyScrollIndex, pendingImportedKeyScrollIndex, queueKeyRowScroll]);

  const canSave =
    !disableControls &&
    !loading &&
    !saving &&
    !invalidIndexParam &&
    !invalidIndex &&
    !isTestingKeys;
  const hasConfiguredModels = form.modelEntries.some((entry) => entry.name.trim());
  const hasTestableKeys = form.apiKeyEntries.some((entry) => entry.apiKey?.trim());
  const modelSelectOptions = useMemo(() => {
    const seen = new Set<string>();
    return form.modelEntries.reduce<Array<{ value: string; label: string }>>((acc, entry) => {
      const name = entry.name.trim();
      if (!name || seen.has(name)) return acc;
      seen.add(name);
      const alias = entry.alias.trim();
      acc.push({
        value: name,
        label: alias && alias !== name ? `${name} (${alias})` : name,
      });
      return acc;
    }, []);
  }, [form.modelEntries]);
  const connectivityConfigSignature = useMemo(() => {
    const headersSignature = form.headers
      .map((entry) => `${entry.key.trim()}:${entry.value.trim()}`)
      .join('|');
    const modelsSignature = form.modelEntries
      .map((entry) => `${entry.name.trim()}:${entry.alias.trim()}`)
      .join('|');
    return [form.baseUrl.trim(), testModel.trim(), headersSignature, modelsSignature].join('||');
  }, [form.baseUrl, form.headers, form.modelEntries, testModel]);
  const previousConnectivityConfigRef = useRef(connectivityConfigSignature);

  useEffect(() => {
    if (previousConnectivityConfigRef.current === connectivityConfigSignature) {
      return;
    }
    previousConnectivityConfigRef.current = connectivityConfigSignature;
    resetDraftKeyTestStatuses(form.apiKeyEntries.length);
    setTestStatus('idle');
    setTestMessage('');
  }, [
    connectivityConfigSignature,
    form.apiKeyEntries.length,
    resetDraftKeyTestStatuses,
    setTestStatus,
    setTestMessage,
  ]);

  // Test a single key by index
  const runSingleKeyTest = useCallback(
    async (keyIndex: number): Promise<KeyTestStatus> => {
      const baseUrl = form.baseUrl.trim();
      if (!baseUrl) {
        const status: KeyTestStatus = {
          status: 'error',
          message: t('notification.openai_test_url_required'),
        };
        showNotification(status.message, 'error');
        return status;
      }

      const endpoint = buildOpenAIChatCompletionsEndpoint(baseUrl);
      if (!endpoint) {
        const status: KeyTestStatus = {
          status: 'error',
          message: t('notification.openai_test_url_required'),
        };
        showNotification(status.message, 'error');
        return status;
      }

      const keyEntry = form.apiKeyEntries[keyIndex];
      if (!keyEntry?.apiKey?.trim()) {
        const status: KeyTestStatus = {
          status: 'error',
          message: t('notification.openai_test_key_required'),
        };
        setDraftKeyTestStatus(keyIndex, status);
        return status;
      }

      const modelName = testModel.trim() || availableModels[0] || '';
      if (!modelName) {
        const status: KeyTestStatus = {
          status: 'error',
          message: t('notification.openai_test_model_required'),
        };
        showNotification(status.message, 'error');
        return status;
      }

      const customHeaders = buildHeaderObject(form.headers);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...customHeaders,
      };
      if (!hasHeader(headers, 'authorization')) {
        headers.Authorization = `Bearer ${keyEntry.apiKey.trim()}`;
      }

      // Set loading state for this key
      setDraftKeyTestStatus(keyIndex, { status: 'loading', message: '' });

      try {
        const result = await apiCallApi.request(
          {
            authIndex: keyEntry.authIndex,
            method: 'POST',
            url: endpoint,
            header: Object.keys(headers).length ? headers : undefined,
            data: JSON.stringify({
              model: modelName,
              messages: [{ role: 'user', content: 'Hi' }],
              stream: false,
              max_tokens: 5,
            }),
          },
          { timeout: OPENAI_TEST_TIMEOUT_MS }
        );

        const responseBodyText = truncateTestResponse(
          formatTestResponseBody(result.body, result.bodyText)
        );

        if (result.statusCode < 200 || result.statusCode >= 300) {
          const status: KeyTestStatus = {
            status: 'error',
            message: getApiCallErrorMessage(result),
            responseStatusCode: result.statusCode,
            responseBodyText,
          };
          setDraftKeyTestStatus(keyIndex, status);
          return status;
        }

        const status: KeyTestStatus = {
          status: 'success',
          message: '',
          responseStatusCode: result.statusCode,
          responseBodyText,
        };
        setDraftKeyTestStatus(keyIndex, status);
        return status;
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        const errorCode =
          typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code?: string }).code)
            : '';
        const isTimeout = errorCode === 'ECONNABORTED' || message.toLowerCase().includes('timeout');
        const errorMessage = isTimeout
          ? t('ai_providers.openai_test_timeout', { seconds: OPENAI_TEST_TIMEOUT_MS / 1000 })
          : message;
        const status: KeyTestStatus = { status: 'error', message: errorMessage };
        setDraftKeyTestStatus(keyIndex, status);
        return status;
      }
    },
    [
      form.baseUrl,
      form.apiKeyEntries,
      form.headers,
      testModel,
      availableModels,
      t,
      setDraftKeyTestStatus,
      showNotification,
    ]
  );

  const testSingleKey = useCallback(
    async (keyIndex: number): Promise<boolean> => {
      if (isTestingKeys) return false;
      setIsTestingKeys(true);
      try {
        const result = await runSingleKeyTest(keyIndex);
        return result.status === 'success';
      } finally {
        setIsTestingKeys(false);
      }
    },
    [isTestingKeys, runSingleKeyTest]
  );

  // Test all keys
  const testAllKeys = useCallback(async () => {
    if (isTestingKeys) return;

    const baseUrl = form.baseUrl.trim();
    if (!baseUrl) {
      const message = t('notification.openai_test_url_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const endpoint = buildOpenAIChatCompletionsEndpoint(baseUrl);
    if (!endpoint) {
      const message = t('notification.openai_test_url_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const modelName = testModel.trim() || availableModels[0] || '';
    if (!modelName) {
      const message = t('notification.openai_test_model_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const validKeyIndexes = form.apiKeyEntries
      .map((entry, index) => (entry.apiKey?.trim() ? index : -1))
      .filter((index) => index >= 0);
    if (validKeyIndexes.length === 0) {
      const message = t('notification.openai_test_key_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    setIsTestingKeys(true);
    setTestStatus('loading');
    setTestMessage(t('ai_providers.openai_test_running'));
    resetDraftKeyTestStatuses(form.apiKeyEntries.length);
    setActiveTestDetailIndex(null);

    try {
      const results = await Promise.all(validKeyIndexes.map((index) => runSingleKeyTest(index)));

      const successCount = results.filter((result) => result.status === 'success').length;
      const failCount = validKeyIndexes.length - successCount;

      if (failCount === 0) {
        const message = t('ai_providers.openai_test_all_success', { count: successCount });
        setTestStatus('success');
        setTestMessage(message);
        showNotification(message, 'success');
      } else if (successCount === 0) {
        const message = t('ai_providers.openai_test_all_failed', { count: failCount });
        setTestStatus('error');
        setTestMessage(message);
        showNotification(message, 'error');
      } else {
        const message = t('ai_providers.openai_test_all_partial', {
          success: successCount,
          failed: failCount,
        });
        setTestStatus('error');
        setTestMessage(message);
        showNotification(message, 'warning');
      }
    } finally {
      setIsTestingKeys(false);
    }
  }, [
    isTestingKeys,
    form.baseUrl,
    form.apiKeyEntries,
    testModel,
    availableModels,
    t,
    setTestStatus,
    setTestMessage,
    resetDraftKeyTestStatuses,
    runSingleKeyTest,
    showNotification,
  ]);

  const reorderKeyEntriesByStatus = useCallback(
    (statusesByIndex: KeyTestStatus[]) => {
      const currentEntries = form.apiKeyEntries.length
        ? form.apiKeyEntries
        : [buildApiKeyEntry()];
      const items = currentEntries.map((entry, originalIndex) => ({
        entry,
        originalIndex,
        status:
          statusesByIndex[originalIndex] ??
          keyTestStatuses[originalIndex] ??
          buildIdleKeyTestStatus(),
      }));
      const reorderedItems = [...items].sort((a, b) => {
        const rankDiff =
          getKeyReorderRank(a.entry, a.status) - getKeyReorderRank(b.entry, b.status);
        if (rankDiff !== 0) return rankDiff;
        return a.originalIndex - b.originalIndex;
      });
      const changed = reorderedItems.some((item, index) => item.originalIndex !== index);
      if (!changed) return false;

      const nextStatuses = reorderedItems.map((item) => item.status);
      setForm((prev) => ({
        ...prev,
        apiKeyEntries: reorderedItems.map((item) => item.entry),
      }));
      resetDraftKeyTestStatuses(nextStatuses.length);
      nextStatuses.forEach((status, index) => {
        setDraftKeyTestStatus(index, status);
      });
      setActiveTestDetailIndex(null);
      queueKeyRowScroll(0, 120);
      return true;
    },
    [
      form.apiKeyEntries,
      keyTestStatuses,
      queueKeyRowScroll,
      resetDraftKeyTestStatuses,
      setDraftKeyTestStatus,
      setForm,
    ]
  );

  const reorderKeysByAvailability = useCallback(async () => {
    if (isTestingKeys) return;

    const currentEntries = form.apiKeyEntries.length
      ? form.apiKeyEntries
      : [buildApiKeyEntry()];
    if (currentEntries.length <= 1) {
      showNotification(
        t('ai_providers.openai_keys_reorder_unchanged', {
          defaultValue: '密钥顺序已是可用在上、不可用在下',
        }),
        'info'
      );
      return;
    }

    const baseUrl = form.baseUrl.trim();
    if (!baseUrl) {
      const message = t('notification.openai_test_url_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const endpoint = buildOpenAIChatCompletionsEndpoint(baseUrl);
    if (!endpoint) {
      const message = t('notification.openai_test_url_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const modelName = testModel.trim() || availableModels[0] || '';
    if (!modelName) {
      const message = t('notification.openai_test_model_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const validKeyIndexes = currentEntries
      .map((entry, index) => (entry.apiKey?.trim() ? index : -1))
      .filter((index) => index >= 0);
    if (validKeyIndexes.length === 0) {
      const message = t('notification.openai_test_key_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    setIsTestingKeys(true);
    setIsReorderingKeys(true);
    setTestStatus('loading');
    setTestMessage(
      t('ai_providers.openai_keys_reorder_running', {
        defaultValue: '正在测试并重排密钥...',
      })
    );
    resetDraftKeyTestStatuses(currentEntries.length);
    setActiveTestDetailIndex(null);

    try {
      const results = await Promise.all(validKeyIndexes.map((index) => runSingleKeyTest(index)));
      const statusesByIndex = currentEntries.map(() => buildIdleKeyTestStatus());
      validKeyIndexes.forEach((keyIndex, resultIndex) => {
        statusesByIndex[keyIndex] = results[resultIndex] ?? buildIdleKeyTestStatus();
      });

      const successCount = results.filter((result) => result.status === 'success').length;
      const failCount = validKeyIndexes.length - successCount;
      const changed = reorderKeyEntriesByStatus(statusesByIndex);

      if (failCount === 0) {
        setTestStatus('success');
        setTestMessage(t('ai_providers.openai_test_all_success', { count: successCount }));
      } else if (successCount === 0) {
        setTestStatus('error');
        setTestMessage(t('ai_providers.openai_test_all_failed', { count: failCount }));
      } else {
        setTestStatus('error');
        setTestMessage(
          t('ai_providers.openai_test_all_partial', {
            success: successCount,
            failed: failCount,
          })
        );
      }

      showNotification(
        changed
          ? t('ai_providers.openai_keys_reorder_done', {
              defaultValue: '已重排密钥：{{success}} 个可用，{{failed}} 个不可用',
              success: successCount,
              failed: failCount,
            })
          : t('ai_providers.openai_keys_reorder_unchanged', {
              defaultValue: '密钥顺序已是可用在上、不可用在下',
            }),
        changed ? (failCount > 0 ? 'warning' : 'success') : 'info'
      );
    } finally {
      setIsReorderingKeys(false);
      setIsTestingKeys(false);
    }
  }, [
    availableModels,
    form.apiKeyEntries,
    form.baseUrl,
    isTestingKeys,
    reorderKeyEntriesByStatus,
    resetDraftKeyTestStatuses,
    runSingleKeyTest,
    setTestMessage,
    setTestStatus,
    showNotification,
    t,
    testModel,
  ]);

  const openOpenaiModelDiscovery = () => {
    const baseUrl = form.baseUrl.trim();
    if (!baseUrl) {
      showNotification(t('ai_providers.openai_models_fetch_invalid_url'), 'error');
      return;
    }
    navigate('models');
  };

  const clearModelEntries = () => {
    setForm((prev) => ({ ...prev, modelEntries: [] }));
    setTestModel('');
    setTestStatus('idle');
    setTestMessage('');
    resetDraftKeyTestStatuses(form.apiKeyEntries.length);
  };

  const exportApiKeys = useCallback(async () => {
    const lines = form.apiKeyEntries.reduce<string[]>((acc, entry, index) => {
      const apiKey = entry.apiKey.trim();
      if (!apiKey) return acc;
      const isUnavailable = keyTestStatuses[index]?.status === 'error';
      acc.push(isUnavailable ? `#${apiKey}` : apiKey);
      return acc;
    }, []);

    if (lines.length === 0) {
      showNotification(
        t('ai_providers.openai_keys_export_empty', {
          defaultValue: '没有可导出的密钥',
        }),
        'warning'
      );
      return;
    }

    const copied = await copyToClipboard(`${lines.join('\n')}\n`);
    showNotification(
      copied
        ? t('ai_providers.openai_keys_export_success', {
            defaultValue: '已复制 {{count}} 个密钥到剪贴板',
            count: lines.length,
          })
        : t('notification.copy_failed', { defaultValue: '复制失败' }),
      copied ? 'success' : 'error'
    );
  }, [form.apiKeyEntries, keyTestStatuses, showNotification, t]);

  const buildImportedApiKeyEntry = useCallback(
    (apiKey: string) => {
      const proxyUrl = pasteProxyUrl.trim();
      return buildApiKeyEntry({ apiKey, proxyUrl });
    },
    [pasteProxyUrl]
  );

  const renderKeyEntries = (entries: ApiKeyEntry[]) => {
    const list = entries.length ? entries : [buildApiKeyEntry()];

    const updateEntry = (idx: number, field: keyof ApiKeyEntry, value: string) => {
      const next = list.map((entry, i) => (i === idx ? { ...entry, [field]: value } : entry));
      setForm((prev) => ({ ...prev, apiKeyEntries: next }));
      setDraftKeyTestStatus(idx, { status: 'idle', message: '' });
      setTestStatus('idle');
      setTestMessage('');
    };

    const removeEntry = (idx: number) => {
      const next = list.filter((_, i) => i !== idx);
      setForm((prev) => ({
        ...prev,
        apiKeyEntries: next.length ? next : [buildApiKeyEntry()],
      }));
      removeDraftKeyTestStatus(idx);
      setTestStatus('idle');
      setTestMessage('');
      if (activeTestDetailIndex === idx) {
        setActiveTestDetailIndex(null);
      } else if (activeTestDetailIndex !== null && activeTestDetailIndex > idx) {
        setActiveTestDetailIndex(activeTestDetailIndex - 1);
      }
    };

    return (
      <div className={styles.keyEntriesList}>
        <div className={styles.keyEntriesToolbar}>
          <span className={styles.keyEntriesCount}>
            {t('ai_providers.openai_keys_count')}: {list.length}
          </span>
          <label className={styles.pasteProxyControl}>
            <input
              type="text"
              value={pasteProxyUrl}
              onChange={(event) => setPasteProxyUrl(event.target.value)}
              disabled={saving || disableControls || isTestingKeys}
              className={`input ${styles.pasteProxyInput}`}
              placeholder={t('ai_providers.openai_keys_paste_proxy_placeholder', {
                defaultValue: '粘贴时使用代理 URL（如 socks5://...）',
              })}
              aria-label={t('ai_providers.openai_keys_paste_proxy_label', {
                defaultValue: '粘贴时使用代理',
              })}
            />
          </label>
          <div className={styles.keyEntriesActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void reorderKeysByAvailability()}
              loading={isReorderingKeys}
              disabled={
                saving ||
                disableControls ||
                isTestingKeys ||
                list.length <= 1 ||
                !hasConfiguredModels ||
                !hasTestableKeys
              }
              title={t('ai_providers.openai_keys_reorder_hint', {
                defaultValue: '测试所有密钥后，自动把可用密钥排到最上面',
              })}
              className={styles.reorderKeysButton}
            >
              {t('ai_providers.openai_keys_reorder_action', { defaultValue: '自动重排' })}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void exportApiKeys()}
              disabled={saving || disableControls || isTestingKeys || !hasTestableKeys}
              title={t('ai_providers.openai_keys_export_hint', {
                defaultValue: '复制所有密钥到剪贴板，每行一个；不可用密钥会以 # 注释',
              })}
              className={styles.exportKeysButton}
            >
              {t('ai_providers.openai_keys_export_action', { defaultValue: '导出密钥' })}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setBulkKeysOpen(true)}
              disabled={saving || disableControls || isTestingKeys}
              className={styles.addKeyButton}
            >
              {t('ai_providers.openai_keys_bulk_toggle')}
            </Button>
          </div>
        </div>
        <div className={styles.keyTableShell}>
          {/* 表头 */}
          <div className={styles.keyTableHeader}>
            <div className={styles.keyTableColIndex}>#</div>
            <div className={styles.keyTableColStatus}>{t('common.status')}</div>
            <div className={styles.keyTableColKey}>{t('common.api_key')}</div>
            <div className={styles.keyTableColProxy}>{t('common.proxy_url')}</div>
            <div className={styles.keyTableColAction}>{t('common.action')}</div>
          </div>

          {/* 数据行 */}
          {list.map((entry, index) => {
            const keyStatus = keyTestStatuses[index]?.status ?? 'idle';
            const keyTestStatus = keyTestStatuses[index];
            const canTestKey = Boolean(entry.apiKey?.trim()) && hasConfiguredModels;
            const hasTestDetails = Boolean(
              keyTestStatus?.responseBodyText ||
              keyTestStatus?.message ||
              keyTestStatus?.responseStatusCode
            );

            return (
              <div
                key={index}
                ref={(node) => {
                  if (node) {
                    keyRowRefs.current.set(index, node);
                  } else {
                    keyRowRefs.current.delete(index);
                  }
                }}
                className={styles.keyTableRow}
              >
                {/* 序号 */}
                <div className={styles.keyTableColIndex}>{index + 1}</div>

                {/* 状态指示灯 */}
                <div className={styles.keyTableColStatus}>
                  <button
                    type="button"
                    className={styles.keyStatusButton}
                    title={
                      keyTestStatus?.message ||
                      t('ai_providers.openai_test_response_toggle', {
                        defaultValue: 'View test response',
                      })
                    }
                    aria-label={t('ai_providers.openai_test_response_toggle', {
                      defaultValue: 'View test response',
                    })}
                    disabled={!hasTestDetails}
                    onClick={() => {
                      if (!hasTestDetails) return;
                      setActiveTestDetailIndex(index);
                    }}
                  >
                    <StatusIcon status={keyStatus} />
                  </button>
                </div>

                {/* Key 输入框 */}
                <div className={styles.keyTableColKey}>
                  <input
                    type="text"
                    value={entry.apiKey}
                    onChange={(e) => updateEntry(index, 'apiKey', e.target.value)}
                    disabled={saving || disableControls || isTestingKeys}
                    className={`input ${styles.keyTableInput}`}
                    placeholder={t('ai_providers.openai_key_placeholder')}
                  />
                </div>

                {/* Proxy 输入框 */}
                <div className={styles.keyTableColProxy}>
                  <input
                    type="text"
                    value={entry.proxyUrl ?? ''}
                    onChange={(e) => updateEntry(index, 'proxyUrl', e.target.value)}
                    disabled={saving || disableControls || isTestingKeys}
                    className={`input ${styles.keyTableInput}`}
                    placeholder={t('ai_providers.openai_proxy_placeholder')}
                  />
                </div>

                {/* 操作按钮 */}
                <div className={styles.keyTableColAction}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void testSingleKey(index)}
                    disabled={saving || disableControls || isTestingKeys || !canTestKey}
                    loading={keyStatus === 'loading'}
                  >
                    {t('ai_providers.openai_test_single_action')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeEntry(index)}
                    disabled={saving || disableControls || isTestingKeys || list.length <= 1}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const activeTestDetail =
    activeTestDetailIndex !== null ? keyTestStatuses[activeTestDetailIndex] : undefined;
  const activeTestResponseBody =
    activeTestDetail?.responseBodyText?.trim() ||
    t('ai_providers.openai_test_no_response_body', { defaultValue: 'No response body' });
  const activeTestResponseMeta = activeTestDetail?.responseStatusCode
    ? `HTTP ${activeTestDetail.responseStatusCode}`
    : activeTestDetail?.message || '';

  const addBulkEntries = () => {
    const parsedKeys = bulkKeysText
      .split(/[\s,;，；]+/g)
      .map((key) => key.trim())
      .filter(Boolean);
    const currentEntries = form.apiKeyEntries.length ? form.apiKeyEntries : [buildApiKeyEntry()];
    const existingKeys = new Set(
      currentEntries.map((entry) => entry.apiKey.trim()).filter(Boolean)
    );
    const nextKeys: string[] = [];

    parsedKeys.forEach((key) => {
      if (existingKeys.has(key)) return;
      existingKeys.add(key);
      nextKeys.push(key);
    });

    if (nextKeys.length === 0) {
      showNotification(t('ai_providers.openai_keys_bulk_no_new'), 'warning');
      return;
    }

    const baseEntries = currentEntries.filter(
      (entry) => entry.apiKey.trim() || entry.proxyUrl?.trim()
    );
    const next = [...baseEntries, ...nextKeys.map(buildImportedApiKeyEntry)];
    setForm((prev) => ({ ...prev, apiKeyEntries: next }));
    resetDraftKeyTestStatuses(next.length);
    setTestStatus('idle');
    setTestMessage('');
    setBulkKeysText('');
    setBulkKeysOpen(false);
    const appliedProxy = pasteProxyUrl.trim();
    showNotification(
      appliedProxy
        ? t('ai_providers.openai_keys_bulk_added_with_proxy', {
            defaultValue: '已添加 {{count}} 个新密钥，并应用代理',
            count: nextKeys.length,
          })
        : t('ai_providers.openai_keys_bulk_added', { count: nextKeys.length }),
      'success'
    );
  };

  const appendPastedApiKeys = useCallback(
    (parsedKeys: string[]) => {
      if (parsedKeys.length === 0) return false;

      const currentEntries = form.apiKeyEntries.length ? form.apiKeyEntries : [buildApiKeyEntry()];
      const existingKeys = new Set(
        currentEntries.map((entry) => entry.apiKey.trim()).filter(Boolean)
      );
      const nextKeys: string[] = [];

      parsedKeys.forEach((key) => {
        if (existingKeys.has(key)) return;
        existingKeys.add(key);
        nextKeys.push(key);
      });

      if (nextKeys.length === 0) {
        showNotification(t('ai_providers.openai_keys_bulk_no_new'), 'warning');
        return true;
      }

      const baseEntries = currentEntries.filter(
        (entry) => entry.apiKey.trim() || entry.proxyUrl?.trim()
      );
      const next = [...baseEntries, ...nextKeys.map(buildImportedApiKeyEntry)];
      queueKeyRowScroll(next.length - 1);
      setForm((prev) => ({ ...prev, apiKeyEntries: next }));
      resetDraftKeyTestStatuses(next.length);
      setTestStatus('idle');
      setTestMessage('');
      setBulkKeysText('');
      setBulkKeysOpen(false);
      setActiveTestDetailIndex(null);
      const appliedProxy = pasteProxyUrl.trim();
      showNotification(
        appliedProxy
          ? t('ai_providers.openai_keys_bulk_added_with_proxy', {
              defaultValue: '已添加 {{count}} 个新密钥，并应用代理',
              count: nextKeys.length,
            })
          : t('ai_providers.openai_keys_bulk_added', { count: nextKeys.length }),
        'success'
      );
      return true;
    },
    [
      form.apiKeyEntries,
      buildImportedApiKeyEntry,
      pasteProxyUrl,
      queueKeyRowScroll,
      resetDraftKeyTestStatuses,
      setForm,
      setTestMessage,
      setTestStatus,
      showNotification,
      t,
    ]
  );

  useEffect(() => {
    if (loading || saving || disableControls || isTestingKeys || invalidIndexParam || invalidIndex) {
      return;
    }

    const handlePaste = (event: ClipboardEvent) => {
      if (isEditablePasteTarget(event.target)) return;

      const parsedKeys = parseBulkApiKeysText(event.clipboardData?.getData('text') ?? '');
      if (parsedKeys.length === 0) return;

      event.preventDefault();
      appendPastedApiKeys(parsedKeys);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [
    appendPastedApiKeys,
    disableControls,
    invalidIndex,
    invalidIndexParam,
    isTestingKeys,
    loading,
    saving,
  ]);

  return (
    <>
      <SecondaryScreenShell
        ref={swipeRef}
        contentClassName={layoutStyles.content}
        title={title}
        onBack={handleBack}
        backLabel={t('common.back')}
        backAriaLabel={t('common.back')}
        hideTopBarBackButton
        hideTopBarRightAction
        floatingAction={
          <div className={layoutStyles.floatingActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleBack}
              className={layoutStyles.floatingBackButton}
            >
              {t('common.back')}
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              loading={saving}
              disabled={!canSave}
              className={layoutStyles.floatingSaveButton}
            >
              {t('common.save')}
            </Button>
          </div>
        }
        isLoading={loading}
        loadingLabel={t('common.loading')}
      >
        <Card>
          {invalidIndexParam || invalidIndex ? (
            <div className={styles.sectionHint}>{t('common.invalid_provider_index')}</div>
          ) : (
            <div className={styles.openaiEditForm}>
              <Input
                label={t('ai_providers.openai_add_modal_name_label')}
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                disabled={saving || disableControls || isTestingKeys}
              />
              <Input
                label={t('ai_providers.priority_label')}
                hint={t('ai_providers.priority_hint')}
                type="number"
                step={1}
                value={form.priority ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  const parsed = raw.trim() === '' ? undefined : Number(raw);
                  setForm((prev) => ({
                    ...prev,
                    priority: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
                  }));
                }}
                disabled={saving || disableControls || isTestingKeys}
              />
              <Input
                label={t('ai_providers.prefix_label')}
                placeholder={t('ai_providers.prefix_placeholder')}
                value={form.prefix ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, prefix: e.target.value }))}
                hint={t('ai_providers.prefix_hint')}
                disabled={saving || disableControls || isTestingKeys}
              />
              <Input
                label={t('ai_providers.openai_add_modal_url_label')}
                value={form.baseUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                disabled={saving || disableControls || isTestingKeys}
              />

              <HeaderInputList
                entries={form.headers}
                onChange={(entries) => setForm((prev) => ({ ...prev, headers: entries }))}
                addLabel={t('common.custom_headers_add')}
                keyPlaceholder={t('common.custom_headers_key_placeholder')}
                valuePlaceholder={t('common.custom_headers_value_placeholder')}
                removeButtonTitle={t('common.delete')}
                removeButtonAriaLabel={t('common.delete')}
                disabled={saving || disableControls || isTestingKeys}
              />

              {/* 模型配置区域 - 统一布局 */}
              <div className={styles.modelConfigSection}>
                {/* 标题行 */}
                <div className={styles.modelConfigHeader}>
                  <label className={styles.modelConfigTitle}>
                    {hasIndexParam
                      ? t('ai_providers.openai_edit_modal_models_label')
                      : t('ai_providers.openai_add_modal_models_label')}
                  </label>
                  <div className={styles.modelConfigToolbar}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={clearModelEntries}
                      disabled={saving || disableControls || isTestingKeys || !hasConfiguredModels}
                    >
                      {t('ai_providers.openai_models_clear_btn')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          modelEntries: [...prev.modelEntries, { name: '', alias: '' }],
                        }))
                      }
                      disabled={saving || disableControls || isTestingKeys}
                    >
                      {t('ai_providers.openai_models_add_btn')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={openOpenaiModelDiscovery}
                      disabled={saving || disableControls || isTestingKeys}
                    >
                      {t('ai_providers.openai_models_fetch_button')}
                    </Button>
                  </div>
                </div>

                {/* 提示文本 */}
                <div className={styles.sectionHint}>{t('ai_providers.openai_models_hint')}</div>

                {/* 模型列表 */}
                <ModelInputList
                  entries={form.modelEntries}
                  onChange={(entries) => setForm((prev) => ({ ...prev, modelEntries: entries }))}
                  namePlaceholder={t('common.model_name_placeholder')}
                  aliasPlaceholder={t('common.model_alias_placeholder')}
                  disabled={saving || disableControls || isTestingKeys}
                  enableReorder
                  hideAddButton
                  className={styles.modelInputList}
                  rowClassName={`${styles.modelInputRow} ${styles.modelInputRowDraggable}`}
                  inputClassName={styles.modelInputField}
                  dragHandleClassName={styles.modelDragHandle}
                  draggingRowClassName={styles.modelInputRowDragging}
                  dragOverRowClassName={styles.modelInputRowDragOver}
                  reorderButtonTitle={t('ai_providers.openai_models_drag_handle')}
                  reorderButtonAriaLabel={t('ai_providers.openai_models_drag_handle')}
                  removeButtonClassName={styles.modelRowRemoveButton}
                  removeButtonTitle={t('common.delete')}
                  removeButtonAriaLabel={t('common.delete')}
                />

                {/* 测试区域 */}
                <div className={styles.modelTestPanel}>
                  <div className={styles.modelTestMeta}>
                    <label className={styles.modelTestLabel}>
                      {t('ai_providers.openai_test_title')}
                    </label>
                    <span className={styles.modelTestHint}>
                      {t('ai_providers.openai_test_hint')}
                    </span>
                  </div>
                  <div className={styles.modelTestControls}>
                    <Select
                      value={testModel}
                      options={modelSelectOptions}
                      onChange={(value) => {
                        setTestModel(value);
                        setTestStatus('idle');
                        setTestMessage('');
                      }}
                      placeholder={
                        availableModels.length
                          ? t('ai_providers.openai_test_select_placeholder')
                          : t('ai_providers.openai_test_select_empty')
                      }
                      className={styles.openaiTestSelect}
                      ariaLabel={t('ai_providers.openai_test_title')}
                      disabled={
                        saving ||
                        disableControls ||
                        isTestingKeys ||
                        testStatus === 'loading' ||
                        availableModels.length === 0
                      }
                    />
                    <Button
                      variant={testStatus === 'error' ? 'danger' : 'secondary'}
                      size="sm"
                      onClick={() => void testAllKeys()}
                      loading={testStatus === 'loading'}
                      disabled={
                        saving ||
                        disableControls ||
                        isTestingKeys ||
                        testStatus === 'loading' ||
                        !hasConfiguredModels ||
                        !hasTestableKeys
                      }
                      title={t('ai_providers.openai_test_all_hint')}
                      className={styles.modelTestAllButton}
                    >
                      {t('ai_providers.openai_test_all_action')}
                    </Button>
                  </div>
                </div>
                {testMessage && (
                  <div
                    className={`status-badge ${
                      testStatus === 'error'
                        ? 'error'
                        : testStatus === 'success'
                          ? 'success'
                          : 'muted'
                    }`}
                  >
                    {testMessage}
                  </div>
                )}
              </div>

              <div className={styles.keyEntriesSection}>
                <div className={styles.keyEntriesHeader}>
                  <div className={styles.keyEntriesHeaderText}>
                    <label className={styles.keyEntriesTitle}>
                      {t('ai_providers.openai_add_modal_keys_label')}
                    </label>
                    <span className={styles.keyEntriesHint}>
                      {t('ai_providers.openai_keys_hint')}
                    </span>
                  </div>
                </div>
                {renderKeyEntries(form.apiKeyEntries)}
              </div>
            </div>
          )}
        </Card>
      </SecondaryScreenShell>
      <Modal
        open={bulkKeysOpen}
        onClose={() => setBulkKeysOpen(false)}
        title={t('ai_providers.openai_keys_bulk_title')}
        width={640}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkKeysOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={addBulkEntries}
              disabled={
                saving || disableControls || isTestingKeys || bulkKeysText.trim().length === 0
              }
            >
              {t('ai_providers.openai_keys_bulk_apply')}
            </Button>
          </>
        }
      >
        <div className={styles.bulkKeysModalBody}>
          <textarea
            className={`input ${styles.bulkKeysTextarea}`}
            value={bulkKeysText}
            onChange={(event) => setBulkKeysText(event.target.value)}
            placeholder={t('ai_providers.openai_keys_bulk_placeholder')}
            rows={8}
            disabled={saving || disableControls || isTestingKeys}
            autoFocus
          />
          <div className={styles.sectionHint}>{t('ai_providers.openai_keys_bulk_hint')}</div>
        </div>
      </Modal>
      <Modal
        open={activeTestDetailIndex !== null && Boolean(activeTestDetail)}
        onClose={() => setActiveTestDetailIndex(null)}
        title={t('ai_providers.openai_test_response_title', {
          defaultValue: 'Test Response #{{index}}',
          index: activeTestDetailIndex !== null ? activeTestDetailIndex + 1 : '',
        })}
        width={760}
      >
        <div className={styles.keyTestResponseModal}>
          {activeTestResponseMeta && (
            <div className={styles.keyTestResponseMeta}>{activeTestResponseMeta}</div>
          )}
          {activeTestDetail?.message && (
            <div className={styles.keyTestResponseMessage}>{activeTestDetail.message}</div>
          )}
          <pre className={styles.keyTestResponseBody}>{activeTestResponseBody}</pre>
        </div>
      </Modal>
    </>
  );
}
