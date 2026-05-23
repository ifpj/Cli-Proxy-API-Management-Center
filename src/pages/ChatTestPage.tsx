import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconDownload, IconPlay, IconTrash2, IconX } from '@/components/ui/icons';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { apiKeysApi } from '@/services/api/apiKeys';
import { useAuthStore, useConfigStore, useModelsStore, useNotificationStore } from '@/stores';
import { classifyModels, type ModelInfo } from '@/utils/models';
import styles from './ChatTestPage.module.scss';

const CHAT_TEST_TIMEOUT_MS = 45_000;

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  images?: ChatImage[];
};

type ChatImage = {
  name: string;
  type: string;
  dataUrl: string;
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

const toApiMessageContent = (message: ChatMessage) => {
  if (message.role !== 'user' || !message.images?.length) {
    return message.content;
  }

  return [
    { type: 'text', text: message.content || 'Please analyze the attached image.' },
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

  const [selectedModel, setSelectedModel] = useState('');
  const [input, setInput] = useState('');
  const [selectedImages, setSelectedImages] = useState<ChatImage[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [includeHistory, setIncludeHistory] = useState(true);
  const [status, setStatus] = useState<{ type: 'success' | 'warning' | 'error' | 'muted'; text: string }>();
  const [rawResponse, setRawResponse] = useState('');
  const [sending, setSending] = useState(false);
  const apiKeysCache = useRef<string[]>([]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

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
    if (selectedModel || modelOptions.length === 0) return;
    setSelectedModel(modelOptions[0].value);
  }, [modelOptions, selectedModel]);

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

  const handleSend = async () => {
    const content = input.trim();
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

    if (!content && selectedImages.length === 0) {
      const text = t('chat_test.message_required', { defaultValue: '请输入测试消息' });
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

    try {
      const apiKeys = await resolveApiKeys();
      const primaryKey = apiKeys[0];
      if (!primaryKey) {
        throw new Error(t('chat_test.api_key_required', { defaultValue: '未找到可用的代理 API Key' }));
      }

      const userMessage: ChatMessage = {
        role: 'user',
        content,
        images: selectedImages.length ? selectedImages : undefined,
      };
      const nextMessages: ChatMessage[] = [...messages, userMessage];
      const requestMessages = includeHistory ? nextMessages : [userMessage];
      setMessages(nextMessages);
      setInput('');
      setSelectedImages([]);
      if (imageInputRef.current) {
        imageInputRef.current.value = '';
      }

      const result = await apiCallApi.request(
        {
          method: 'POST',
          url: endpoint,
          header: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${primaryKey}`,
          },
          data: JSON.stringify({
            model,
            messages: requestMessages.map((message) => ({
              role: message.role,
              content: toApiMessageContent(message),
            })),
            stream: false,
          }),
        },
        { timeout: CHAT_TEST_TIMEOUT_MS }
      );

      const formatted = formatRawBody(result.body, result.bodyText);
      setRawResponse(formatted);

      if (result.statusCode < 200 || result.statusCode >= 300) {
        const text = getApiCallErrorMessage(result);
        setStatus({ type: 'error', text });
        showNotification(text, 'error');
        return;
      }

      const assistantText = extractAssistantText(result.body, result.bodyText);
      setMessages([...nextMessages, { role: 'assistant', content: assistantText || formatted }]);
      setStatus({ type: 'success', text: t('chat_test.success', { defaultValue: '对话测试成功' }) });
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error || '');
      setStatus({ type: 'error', text });
      showNotification(text, 'error');
    } finally {
      setSending(false);
    }
  };

  const clearMessages = () => {
    setMessages([]);
    setSelectedImages([]);
    setRawResponse('');
    setStatus(undefined);
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
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
                  <span className={styles.role}>
                    {message.role === 'user'
                      ? t('chat_test.user', { defaultValue: '用户' })
                      : t('chat_test.assistant', { defaultValue: '助手' })}
                  </span>
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
                {selectedImages.length > 0 && (
                  <span className={styles.metaLine}>
                    {t('chat_test.image_count', {
                      count: selectedImages.length,
                      defaultValue: '已选 {{count}} 张图片',
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
            {status && <div className={`status-badge ${status.type}`}>{status.text}</div>}
            {rawResponse && (
              <div className={styles.field}>
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
