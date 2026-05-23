import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconDownload, IconPlay, IconRefreshCw, IconTrash2, IconX } from '@/components/ui/icons';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { apiKeysApi } from '@/services/api/apiKeys';
import { useAuthStore, useConfigStore, useModelsStore, useNotificationStore } from '@/stores';
import { classifyModels, type ModelInfo } from '@/utils/models';
import styles from './ChatTestPage.module.scss';

const CHAT_TEST_TIMEOUT_MS = 45_000;
const CHAT_TEST_SELECTED_MODEL_KEY = 'chat-test:selected-model';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  images?: ChatImage[];
  files?: ChatFile[];
  elapsedMs?: number;
  stats?: ChatExchangeStats;
};

type ChatExchangeStats = {
  requestChars: number;
  requestBytes: number;
  responseChars: number;
  responseBytes: number;
};

type ChatImage = {
  name: string;
  type: string;
  dataUrl: string;
};

type ChatFile = {
  name: string;
  type: string;
  size: number;
  content: string;
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

const buildChatEndpoint = (baseUrl: string): string => {
  let trimmed = String(baseUrl || '').trim().replace(/\/?v0\/management\/?$/i, '');
  trimmed = trimmed.replace(/\/+$/g, '');
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  if (/\/v1\/chat\/completions$/i.test(trimmed) || /\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }
  if (/\/v1$/i.test(trimmed)) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
};

const extractAssistantText = (body: unknown, fallback: string): string => {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object';

  if (isRecord(body)) {
    const choices = body.choices;
    if (Array.isArray(choices)) {
      const first = choices[0];
      if (isRecord(first)) {
        const message = first.message;
        if (isRecord(message) && typeof message.content === 'string') {
          return message.content;
        }
        if (typeof first.text === 'string') {
          return first.text;
        }
      }
    }
    if (typeof body.output_text === 'string') {
      return body.output_text;
    }
  }

  return fallback || '';
};

const formatRawBody = (body: unknown, bodyText: string): string => {
  if (body !== null && body !== undefined && typeof body !== 'string') {
    try {
      return JSON.stringify(body, null, 2);
    } catch {
      return String(body);
    }
  }
  return bodyText || String(body ?? '');
};

const modelLabel = (model: ModelInfo) => (model.alias ? `${model.name} (${model.alias})` : model.name);

const formatElapsed = (elapsedMs: number) =>
  elapsedMs < 1000 ? `${elapsedMs} ms` : `${(elapsedMs / 1000).toFixed(2)} s`;

const countChars = (value: string) => Array.from(value).length;

const countBytes = (value: string) => new TextEncoder().encode(value).length;

const formatNumber = (value: number) => value.toLocaleString();

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const readImageFile = (file: File): Promise<ChatImage> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) {
        reject(new Error('Failed to read image'));
        return;
      }
      resolve({
        name: file.name,
        type: file.type || 'image/*',
        dataUrl,
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });

const isTextFile = (file: File) => {
  if (file.type.startsWith('text/')) return true;
  return /\.(csv|json|log|md|txt|xml|yaml|yml)$/i.test(file.name);
};

const readTextFile = (file: File): Promise<ChatFile> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === 'string' ? reader.result : '';
      resolve({
        name: file.name,
        type: file.type || 'text/plain',
        size: file.size,
        content: raw,
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsText(file);
  });

const formatFileForPrompt = (file: ChatFile) =>
  `<file name="${file.name}" type="${file.type}" size="${file.size}">\n${file.content}\n</file>`;

const buildMessageText = (message: ChatMessage) => {
  const fileText = message.files?.length
    ? `\n\n${message.files.map(formatFileForPrompt).join('\n\n')}`
    : '';
  return `${message.content}${fileText}`;
};

const toApiMessageContent = (message: ChatMessage) => {
  const text = buildMessageText(message);

  if (message.role !== 'user' || !message.images?.length) {
    return text;
  }

  return [
    { type: 'text', text: text || 'Please analyze the attached image.' },
    ...message.images.map((image) => ({
      type: 'image_url',
      image_url: { url: image.dataUrl },
    })),
  ];
};

export function ChatTestPage() {
  const { t, i18n } = useTranslation();
  const { showNotification } = useNotificationStore();
  const auth = useAuthStore();
  const config = useConfigStore((state) => state.config);
  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

  const [selectedModel, setSelectedModel] = useLocalStorage(CHAT_TEST_SELECTED_MODEL_KEY, '');
  const [input, setInput] = useState('');
  const [selectedImages, setSelectedImages] = useState<ChatImage[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<ChatFile[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [includeHistory, setIncludeHistory] = useState(true);
  const [status, setStatus] = useState<{ type: 'success' | 'warning' | 'error' | 'muted'; text: string }>();
  const [rawResponse, setRawResponse] = useState('');
  const [lastElapsedMs, setLastElapsedMs] = useState<number | null>(null);
  const [lastStats, setLastStats] = useState<ChatExchangeStats | null>(null);
  const [sending, setSending] = useState(false);
  const [resendingIndex, setResendingIndex] = useState<number | null>(null);
  const apiKeysCache = useRef<string[]>([]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const modelOptions = useMemo(
    () => models.map((model) => ({ value: model.name, label: modelLabel(model) })),
    [models]
  );
  const otherLabel = useMemo(
    () => (i18n.language?.toLowerCase().startsWith('zh') ? '其他' : 'Other'),
    [i18n.language]
  );
  const groupedModels = useMemo(() => classifyModels(models, { otherLabel }), [models, otherLabel]);

  const resolveApiKeys = useCallback(async () => {
    if (apiKeysCache.current.length) return apiKeysCache.current;

    const configKeys = normalizeApiKeyList(config?.apiKeys);
    if (configKeys.length) {
      apiKeysCache.current = configKeys;
      return configKeys;
    }

    const list = await apiKeysApi.list();
    const normalized = normalizeApiKeyList(list);
    apiKeysCache.current = normalized;
    return normalized;
  }, [config?.apiKeys]);

  useEffect(() => {
    apiKeysCache.current = [];
  }, [auth.apiBase, config?.apiKeys]);

  useEffect(() => {
    if (modelOptions.length === 0) return;
    if (selectedModel && modelOptions.some((model) => model.value === selectedModel)) return;
    setSelectedModel(modelOptions[0].value);
  }, [modelOptions, selectedModel, setSelectedModel]);

  useEffect(() => {
    const loadModels = async () => {
      if (auth.connectionStatus !== 'connected' || !auth.apiBase || models.length > 0) return;
      try {
        const apiKeys = await resolveApiKeys();
        await fetchModelsFromStore(auth.apiBase, apiKeys[0]);
      } catch {
        // The page can still test a manually entered model if model discovery fails later.
      }
    };

    void loadModels();
  }, [auth.apiBase, auth.connectionStatus, fetchModelsFromStore, models.length, resolveApiKeys]);

  const sendMessages = async (nextMessages: ChatMessage[], requestMessages: ChatMessage[]) => {
    const model = selectedModel.trim();

    if (auth.connectionStatus !== 'connected' || !auth.apiBase) {
      const text = t('notification.connection_required');
      setStatus({ type: 'warning', text });
      showNotification(text, 'warning');
      return;
    }

    if (!model) {
      const text = t('chat_test.model_required', { defaultValue: '请选择模型' });
      setStatus({ type: 'warning', text });
      showNotification(text, 'warning');
      return;
    }

    const endpoint = buildChatEndpoint(auth.apiBase);
    if (!endpoint) {
      const text = t('chat_test.endpoint_invalid', { defaultValue: '连接地址无效' });
      setStatus({ type: 'error', text });
      showNotification(text, 'error');
      return;
    }

    setSending(true);
    setStatus({ type: 'muted', text: t('chat_test.sending', { defaultValue: '正在发送...' }) });
    setRawResponse('');
    setLastElapsedMs(null);
    setLastStats(null);

    try {
      const apiKeys = await resolveApiKeys();
      const primaryKey = apiKeys[0];
      if (!primaryKey) {
        throw new Error(t('chat_test.api_key_required', { defaultValue: '未找到可用的代理 API Key' }));
      }

      setMessages(nextMessages);

      const requestBody = JSON.stringify({
        model,
        messages: requestMessages.map((message) => ({
          role: message.role,
          content: toApiMessageContent(message),
        })),
        stream: false,
      });
      const requestStats = {
        requestChars: countChars(requestBody),
        requestBytes: countBytes(requestBody),
      };

      const startedAt = performance.now();
      const result = await apiCallApi.request(
        {
          method: 'POST',
          url: endpoint,
          header: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${primaryKey}`,
          },
          data: requestBody,
        },
        { timeout: CHAT_TEST_TIMEOUT_MS }
      );
      const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
      setLastElapsedMs(elapsedMs);

      const formatted = formatRawBody(result.body, result.bodyText);
      const stats: ChatExchangeStats = {
        ...requestStats,
        responseChars: countChars(formatted),
        responseBytes: countBytes(formatted),
      };
      setRawResponse(formatted);
      setLastStats(stats);

      if (result.statusCode < 200 || result.statusCode >= 300) {
        const text = getApiCallErrorMessage(result);
        setStatus({ type: 'error', text });
        showNotification(text, 'error');
        return;
      }

      const assistantText = extractAssistantText(result.body, result.bodyText);
      setMessages([...nextMessages, { role: 'assistant', content: assistantText || formatted, elapsedMs, stats }]);
      setStatus({
        type: 'success',
        text: `${t('chat_test.success', { defaultValue: '对话测试成功' })} · ${formatElapsed(elapsedMs)}`,
      });
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error || '');
      setStatus({ type: 'error', text });
      showNotification(text, 'error');
    } finally {
      setSending(false);
      setResendingIndex(null);
    }
  };

  const handleSend = async () => {
    const content = input.trim();

    if (!content && selectedImages.length === 0 && selectedFiles.length === 0) {
      const text = t('chat_test.message_required', { defaultValue: '请输入测试消息' });
      setStatus({ type: 'warning', text });
      showNotification(text, 'warning');
      return;
    }

    const userMessage: ChatMessage = {
      role: 'user',
      content,
      images: selectedImages.length ? selectedImages : undefined,
      files: selectedFiles.length ? selectedFiles : undefined,
    };
    const nextMessages: ChatMessage[] = [...messages, userMessage];
    const requestMessages = includeHistory ? nextMessages : [userMessage];

    setInput('');
    setSelectedImages([]);
    setSelectedFiles([]);
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    await sendMessages(nextMessages, requestMessages);
  };

  const handleResend = async (index: number) => {
    const message = messages[index];
    if (!message || message.role !== 'user') return;

    const nextMessages = messages.slice(0, index + 1);
    const requestMessages = includeHistory ? nextMessages : [message];
    setResendingIndex(index);
    await sendMessages(nextMessages, requestMessages);
  };

  const clearMessages = () => {
    setMessages([]);
    setSelectedImages([]);
    setSelectedFiles([]);
    setRawResponse('');
    setLastElapsedMs(null);
    setLastStats(null);
    setStatus(undefined);
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []).filter((file) =>
      file.type.startsWith('image/')
    );
    if (!files.length) return;

    try {
      const images = await Promise.all(files.map(readImageFile));
      setSelectedImages((current) => [...current, ...images]);
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error || '');
      setStatus({ type: 'error', text });
      showNotification(text, 'error');
    }
  };

  const removeSelectedImage = (index: number) => {
    setSelectedImages((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    const textFiles = files.filter(isTextFile);
    const skipped = files.length - textFiles.length;

    if (skipped > 0) {
      showNotification(
        t('chat_test.file_skipped', {
          count: skipped,
          defaultValue: '已跳过 {{count}} 个非文本文件',
        }),
        'warning'
      );
    }
    if (!textFiles.length) return;

    try {
      const attachments = await Promise.all(textFiles.map(readTextFile));
      setSelectedFiles((current) => [...current, ...attachments]);
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error || '');
      setStatus({ type: 'error', text });
      showNotification(text, 'error');
    }
  };

  const removeSelectedFile = (index: number) => {
    setSelectedFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('chat_test.title', { defaultValue: '对话测试' })}</h1>
      <div className={styles.content}>
        <Card
          className={styles.chatCard}
          title={t('chat_test.conversation_title', { defaultValue: '测试对话' })}
          extra={
            <Button
              variant="secondary"
              size="sm"
              onClick={clearMessages}
              disabled={sending || messages.length === 0}
            >
              <IconTrash2 size={14} />
              {t('common.clear', { defaultValue: '清空' })}
            </Button>
          }
        >
          <div className={styles.messages}>
            {messages.length === 0 ? (
              <div className={styles.empty}>
                {t('chat_test.empty', { defaultValue: '输入一条消息来测试当前代理的对话接口。' })}
              </div>
            ) : (
              messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`${styles.message} ${
                    message.role === 'user' ? styles.messageUser : styles.messageAssistant
                  }`}
                >
                  <div className={styles.messageHeader}>
                    <span className={styles.role}>
                      {message.role === 'user'
                        ? t('chat_test.user', { defaultValue: '用户' })
                        : t('chat_test.assistant', { defaultValue: '助手' })}
                    </span>
                    {message.role === 'user' && (
                      <button
                        type="button"
                        className={styles.messageAction}
                        onClick={() => void handleResend(index)}
                        disabled={sending}
                        title={t('chat_test.resend', { defaultValue: '重新发送' })}
                        aria-label={t('chat_test.resend', { defaultValue: '重新发送' })}
                      >
                        <IconRefreshCw size={13} />
                        <span>
                          {resendingIndex === index
                            ? t('chat_test.resending', { defaultValue: '重发中' })
                            : t('chat_test.resend', { defaultValue: '重新发送' })}
                        </span>
                      </button>
                    )}
                    {message.role === 'assistant' &&
                      (typeof message.elapsedMs === 'number' || message.stats) && (
                        <span className={styles.messageMetric}>
                          {[
                            typeof message.elapsedMs === 'number'
                              ? t('chat_test.elapsed', {
                                  value: formatElapsed(message.elapsedMs),
                                  defaultValue: '耗时 {{value}}',
                                })
                              : null,
                            message.stats
                              ? t('chat_test.message_response_stats', {
                                  chars: formatNumber(message.stats.responseChars),
                                  bytes: formatBytes(message.stats.responseBytes),
                                  defaultValue: '响应 {{chars}} 字 / {{bytes}}',
                                })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                  </div>
                  {message.content && <div className={styles.bubble}>{message.content}</div>}
                  {message.images?.length ? (
                    <div className={styles.messageImages}>
                      {message.images.map((image, imageIndex) => (
                        <img
                          key={`${image.name}-${imageIndex}`}
                          src={image.dataUrl}
                          alt={image.name}
                          className={styles.messageImage}
                        />
                      ))}
                    </div>
                  ) : null}
                  {message.files?.length ? (
                    <div className={styles.fileChips}>
                      {message.files.map((file, fileIndex) => (
                        <span key={`${file.name}-${fileIndex}`} className={styles.fileChip} title={file.name}>
                          {file.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <div className={styles.composer}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="chat-test-message">
                {t('chat_test.message_label', { defaultValue: '测试消息' })}
              </label>
              <textarea
                id="chat-test-message"
                className={`input ${styles.textarea}`}
                value={input}
                onChange={(event) => setInput(event.currentTarget.value)}
                placeholder={t('chat_test.message_placeholder', {
                  defaultValue: '输入要发送给模型的内容...',
                })}
                disabled={sending}
              />
              <div className={styles.imageToolbar}>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className={styles.fileInput}
                  onChange={(event) => void handleImageChange(event)}
                  disabled={sending}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json,.log,.md,.txt,.xml,.yaml,.yml,text/*,application/json"
                  multiple
                  className={styles.fileInput}
                  onChange={(event) => void handleFileChange(event)}
                  disabled={sending}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={sending}
                >
                  <IconDownload size={14} />
                  {t('chat_test.add_image', { defaultValue: '添加图片' })}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                >
                  <IconDownload size={14} />
                  {t('chat_test.add_file', { defaultValue: '添加文件' })}
                </Button>
                {selectedImages.length > 0 && (
                  <span className={styles.metaLine}>
                    {t('chat_test.image_count', {
                      count: selectedImages.length,
                      defaultValue: '已选 {{count}} 张图片',
                    })}
                  </span>
                )}
                {selectedFiles.length > 0 && (
                  <span className={styles.metaLine}>
                    {t('chat_test.file_count', {
                      count: selectedFiles.length,
                      defaultValue: '已选 {{count}} 个文件',
                    })}
                  </span>
                )}
              </div>
              {selectedImages.length > 0 && (
                <div className={styles.imagePreviewGrid}>
                  {selectedImages.map((image, index) => (
                    <div key={`${image.name}-${index}`} className={styles.imagePreview}>
                      <img src={image.dataUrl} alt={image.name} />
                      <button
                        type="button"
                        className={styles.removeImage}
                        onClick={() => removeSelectedImage(index)}
                        aria-label={t('common.delete')}
                        disabled={sending}
                      >
                        <IconX size={14} />
                      </button>
                      <span title={image.name}>{image.name}</span>
                    </div>
                  ))}
                </div>
              )}
              {selectedFiles.length > 0 && (
                <div className={styles.filePreviewList}>
                  {selectedFiles.map((file, index) => (
                    <div key={`${file.name}-${index}`} className={styles.filePreview}>
                      <span title={file.name}>{file.name}</span>
                      <button
                        type="button"
                        className={styles.removeFile}
                        onClick={() => removeSelectedFile(index)}
                        aria-label={t('common.delete')}
                        disabled={sending}
                      >
                        <IconX size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className={styles.actions}>
              <Button onClick={() => void handleSend()} loading={sending}>
                <IconPlay size={14} />
                {t('chat_test.send', { defaultValue: '发送测试' })}
              </Button>
            </div>
          </div>
        </Card>

        <Card className={styles.settingsCard} title={t('chat_test.settings_title', { defaultValue: '请求设置' })}>
          <div className={styles.settingsStack}>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>
                {t('chat_test.model_label', { defaultValue: '模型' })}
              </label>
              <select
                className="input"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.currentTarget.value)}
                disabled={sending || modelsLoading || modelOptions.length === 0}
              >
                <option value="" disabled>
                  {modelsLoading
                    ? t('system_info.models_loading')
                    : t('chat_test.model_placeholder', { defaultValue: '选择模型' })}
                </option>
                {groupedModels.map((group) => (
                  <optgroup key={group.id} label={`${group.label} (${group.items.length})`}>
                    {group.items.map((model) => (
                      <option key={`${group.id}-${model.name}-${model.alias ?? 'default'}`} value={model.name}>
                        {modelLabel(model)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>
                {t('chat_test.endpoint_label', { defaultValue: '接口地址' })}
              </span>
              <code>{buildChatEndpoint(auth.apiBase || '') || '-'}</code>
            </div>
            <div className={styles.settingRow}>
              <div>
                <div className={styles.fieldLabel}>
                  {t('chat_test.include_history_label', { defaultValue: '连续对话' })}
                </div>
                <div className={styles.settingHint}>
                  {includeHistory
                    ? t('chat_test.include_history_on', {
                        defaultValue: '发送时携带当前页面的历史消息',
                      })
                    : t('chat_test.include_history_off', {
                        defaultValue: '发送时只使用当前消息',
                      })}
                </div>
              </div>
              <ToggleSwitch
                checked={includeHistory}
                onChange={setIncludeHistory}
                disabled={sending}
                ariaLabel={t('chat_test.include_history_label', { defaultValue: '连续对话' })}
              />
            </div>
            <div className={styles.metaLine}>
              {t('chat_test.history_count', {
                count: messages.length,
                defaultValue: '历史消息 {{count}} 条',
              })}
            </div>
            {lastElapsedMs !== null && (
              <div className={styles.metaLine}>
                {t('chat_test.last_elapsed', {
                  value: formatElapsed(lastElapsedMs),
                  defaultValue: '最近响应耗时 {{value}}',
                })}
              </div>
            )}
            {lastStats && (
              <div className={styles.statsGrid}>
                <div className={styles.statItem}>
                  <span>{t('chat_test.request_chars', { defaultValue: '请求字数' })}</span>
                  <strong>{formatNumber(lastStats.requestChars)}</strong>
                </div>
                <div className={styles.statItem}>
                  <span>{t('chat_test.request_size', { defaultValue: '请求大小' })}</span>
                  <strong>{formatBytes(lastStats.requestBytes)}</strong>
                </div>
                <div className={styles.statItem}>
                  <span>{t('chat_test.response_chars', { defaultValue: '响应字数' })}</span>
                  <strong>{formatNumber(lastStats.responseChars)}</strong>
                </div>
                <div className={styles.statItem}>
                  <span>{t('chat_test.response_size', { defaultValue: '响应大小' })}</span>
                  <strong>{formatBytes(lastStats.responseBytes)}</strong>
                </div>
              </div>
            )}
            {status && <div className={`status-badge ${status.type}`}>{status.text}</div>}
            {rawResponse && (
              <div className={`${styles.field} ${styles.rawResponseField}`}>
                <span className={styles.fieldLabel}>
                  {t('chat_test.raw_response', { defaultValue: '原始响应' })}
                </span>
                <pre className={styles.rawResponse}>{rawResponse}</pre>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
