import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconEye,
  IconInfo,
  IconModelCluster,
  IconPencil,
  IconPlay,
  IconSlidersHorizontal,
  IconTrash2,
  IconX,
} from '@/components/ui/icons';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import type { OpenAIProviderConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import { statusBarDataFromRecentRequests } from '@/utils/recentRequests';
import styles from '@/pages/AiProvidersPage.module.scss';
import { ProviderStatusBar } from '../ProviderStatusBar';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import {
  getOpenAIProviderRecentStatusData,
  getOpenAIProviderRecentWindowStats,
  getOpenAIProviderTotalStats,
  getOpenAIProviderKey,
  getProviderTotalStats,
  type ProviderRecentUsageMap,
} from '../utils';

type SortOption = 'config-order' | 'name' | 'priority' | 'recent-success' | 'total-success';
type SortDirection = 'asc' | 'desc';

interface FloatingToolbarStyle {
  left: number;
  top: number;
  width: number;
  visible: boolean;
}

const EMPTY_STATUS_BAR = statusBarDataFromRecentRequests([]);

interface OpenAISectionProps {
  configs: OpenAIProviderConfig[];
  usageByProvider: ProviderRecentUsageMap;
  loading: boolean;
  disableControls: boolean;
  isSwitching: boolean;
  resolvedTheme: string;
  isTestingProvider: boolean;
  testResults: Record<
    number,
    {
      status: 'idle' | 'loading' | 'success' | 'error';
      message: string;
      responseStatusCode?: number;
      responseBodyText?: string;
      successMessage?: string;
      failureMessage?: string;
      successResponseBodyText?: string;
      failureResponseBodyText?: string;
    }
  >;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onToggle: (index: number, enabled: boolean) => void;
  onTest: (index: number) => void;
  onOpenTestResult: (index: number, group?: 'success' | 'failure') => void;
  toolbarPortalTarget?: HTMLElement | null;
}

interface IndexedOpenAIProvider {
  config: OpenAIProviderConfig;
  originalIndex: number;
}

const getApiKeyEntryRenderKey = (
  entry: NonNullable<OpenAIProviderConfig['apiKeyEntries']>[number],
  entryIndex: number
) => {
  const authIndex = entry.authIndex == null ? '' : String(entry.authIndex).trim();
  return authIndex ? `auth-index-${authIndex}` : `api-key-entry-${entryIndex}`;
};

const getModelFilterName = (model: NonNullable<OpenAIProviderConfig['models']>[number]) =>
  (model.alias || model.name || '').trim();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchesModelSearch = (modelName: string, search: string) => {
  const normalizedName = modelName.toLowerCase();
  const terms = search
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) return true;

  return terms.every((term) => {
    if (term === '*') return true;
    if (!term.includes('*')) return normalizedName.includes(term);
    const pattern = term.split('*').map(escapeRegExp).join('.*');
    return new RegExp(pattern).test(normalizedName);
  });
};

export function OpenAISection({
  configs,
  usageByProvider,
  loading,
  disableControls,
  isSwitching,
  resolvedTheme,
  isTestingProvider,
  testResults,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
  onTest,
  onOpenTestResult,
  toolbarPortalTarget,
}: OpenAISectionProps) {
  const { t } = useTranslation();
  const pageTransitionLayer = usePageTransitionLayer();
  const isTransitionAnimating = pageTransitionLayer?.isAnimating ?? false;
  const actionsDisabled = disableControls || loading || isSwitching || isTestingProvider;
  const toggleDisabled = disableControls || loading || isSwitching || isTestingProvider;
  const [sortOption, setSortOption] = useState<SortOption>('config-order');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [modelFilterSearch, setModelFilterSearch] = useState('');
  const [keyModalProvider, setKeyModalProvider] = useState<IndexedOpenAIProvider | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownLayout, setDropdownLayout] = useState({ openAbove: false, maxHeight: 300 });
  const [floatingToolbarStyle, setFloatingToolbarStyle] = useState<FloatingToolbarStyle>({
    left: 0,
    top: 0,
    width: 0,
    visible: false,
  });
  const sectionRef = useRef<HTMLDivElement>(null);
  const topToolbarAnchorRef = useRef<HTMLDivElement>(null);
  const topDropdownRef = useRef<HTMLDivElement>(null);
  const floatingDropdownRef = useRef<HTMLDivElement>(null);
  const modelSearchInputRef = useRef<HTMLInputElement>(null);

  const shouldRenderFloatingToolbar = false;

  useEffect(() => {
    if (isTransitionAnimating) {
      return;
    }

    const updateFloatingToolbar = () => {
      const section = sectionRef.current;
      const anchor = topToolbarAnchorRef.current;

      if (!section || !anchor) {
        return;
      }

      const sectionRect = section.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const rootStyles = getComputedStyle(document.documentElement);
      const fixedTop = Number.parseFloat(rootStyles.getPropertyValue('--header-height')) || 64;
      const toolbarHeight = anchorRect.height;
      const isMobile = window.innerWidth <= 768;
      const shouldShow =
        !isMobile && anchorRect.top <= fixedTop && sectionRect.bottom > fixedTop + toolbarHeight;

      setFloatingToolbarStyle((prev) => {
        const next = {
          left: sectionRect.left,
          top: fixedTop,
          width: sectionRect.width,
          visible: shouldShow,
        };

        if (
          prev.left === next.left &&
          prev.top === next.top &&
          prev.width === next.width &&
          prev.visible === next.visible
        ) {
          return prev;
        }

        return next;
      });
    };

    updateFloatingToolbar();
    window.addEventListener('resize', updateFloatingToolbar);
    window.addEventListener('scroll', updateFloatingToolbar, true);

    return () => {
      window.removeEventListener('resize', updateFloatingToolbar);
      window.removeEventListener('scroll', updateFloatingToolbar, true);
    };
  }, [
    configs.length,
    isDropdownOpen,
    isTransitionAnimating,
    selectedModels,
    sortDirection,
    sortOption,
  ]);

  useEffect(() => {
    if (!isDropdownOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedTop = topDropdownRef.current?.contains(target);
      const clickedFloating = floatingDropdownRef.current?.contains(target);

      if (!clickedTop && !clickedFloating) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  useEffect(() => {
    if (!isDropdownOpen) {
      return;
    }

    const updateDropdownLayout = () => {
      const wrapper = floatingToolbarStyle.visible
        ? floatingDropdownRef.current
        : topDropdownRef.current;

      if (!wrapper) {
        return;
      }

      const rect = wrapper.getBoundingClientRect();
      const viewportPadding = 12;
      const dropdownGap = 4;
      const preferredMaxHeight = 300;
      const minimumMaxHeight = 120;
      const availableBelow = Math.max(
        0,
        window.innerHeight - rect.bottom - viewportPadding - dropdownGap
      );
      const availableAbove = Math.max(0, rect.top - viewportPadding - dropdownGap);
      const openAbove = availableBelow < preferredMaxHeight && availableAbove > availableBelow;
      const availableSpace = openAbove ? availableAbove : availableBelow;
      const maxHeight = Math.max(minimumMaxHeight, Math.min(preferredMaxHeight, availableSpace));

      setDropdownLayout((prev) => {
        if (prev.openAbove === openAbove && prev.maxHeight === maxHeight) {
          return prev;
        }

        return { openAbove, maxHeight };
      });
    };

    updateDropdownLayout();
    window.addEventListener('resize', updateDropdownLayout);
    window.addEventListener('scroll', updateDropdownLayout, true);

    return () => {
      window.removeEventListener('resize', updateDropdownLayout);
      window.removeEventListener('scroll', updateDropdownLayout, true);
    };
  }, [floatingToolbarStyle.visible, isDropdownOpen]);

  const allModelNames = useMemo(() => {
    const modelSet = new Set<string>();
    configs.forEach((provider) => {
      provider.models?.forEach((model) => {
        const filterName = getModelFilterName(model);
        if (filterName) {
          modelSet.add(filterName);
        }
      });
    });
    return Array.from(modelSet).sort();
  }, [configs]);
  const selectedModelNames = useMemo(() => Array.from(selectedModels).sort(), [selectedModels]);
  const filteredModelNames = useMemo(
    () => allModelNames.filter((name) => matchesModelSearch(name, modelFilterSearch)),
    [allModelNames, modelFilterSearch]
  );
  const modelFilterActive = selectedModelNames.length > 0;
  const modelFilterLabel = modelFilterActive
    ? t('ai_providers.model_discovery_selected_count', { count: selectedModelNames.length })
    : t('ai_providers.model_search_placeholder');
  const modelFilterTitle = modelFilterActive
    ? selectedModelNames.join(', ')
    : t('ai_providers.model_search_placeholder');

  const statusBarCache = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof statusBarDataFromRecentRequests>>();

    configs.forEach((provider, index) => {
      const providerKey = getOpenAIProviderKey(provider, index);
      cache.set(providerKey, getOpenAIProviderRecentStatusData(provider, usageByProvider));
    });

    return cache;
  }, [configs, usageByProvider]);

  const sortOptions = useMemo(
    () => [
      { value: 'config-order', label: t('ai_providers.sort_by_config_order') },
      { value: 'priority', label: t('ai_providers.sort_by_priority') },
      { value: 'name', label: t('ai_providers.sort_by_name') },
      { value: 'recent-success', label: t('ai_providers.sort_by_recent_success') },
      { value: 'total-success', label: t('ai_providers.sort_by_total_success') },
    ],
    [t]
  );

  const sortedConfigs = useMemo<IndexedOpenAIProvider[]>(() => {
    const indexed = configs.map((config, originalIndex) => ({ config, originalIndex }));
    const filtered = indexed.filter(({ config }) => {
      if (selectedModels.size === 0) return true;
      return config.models?.some((model) => selectedModels.has(getModelFilterName(model)));
    });

    const sorted = [...filtered];
    const direction = sortDirection === 'desc' ? -1 : 1;
    const providerStats =
      sortOption === 'recent-success' || sortOption === 'total-success'
        ? new Map(
            sorted.map(({ config }) => [
              config,
              sortOption === 'recent-success'
                ? getOpenAIProviderRecentWindowStats(config, usageByProvider)
                : getOpenAIProviderTotalStats(config, usageByProvider),
            ])
          )
        : null;

    switch (sortOption) {
      case 'config-order':
        break;
      case 'name':
        sorted.sort((a, b) => direction * a.config.name.localeCompare(b.config.name));
        break;
      case 'priority':
        sorted.sort((a, b) => {
          const priorityA = a.config.priority ?? 0;
          const priorityB = b.config.priority ?? 0;
          const priorityDiff = priorityA - priorityB;

          if (priorityDiff !== 0) {
            return direction * priorityDiff;
          }

          return direction * a.config.name.localeCompare(b.config.name);
        });
        break;
      case 'recent-success':
      case 'total-success':
        sorted.sort((a, b) => {
          const successDiff =
            (providerStats?.get(a.config)?.success ?? 0) -
            (providerStats?.get(b.config)?.success ?? 0);

          if (successDiff !== 0) {
            return direction * successDiff;
          }

          return direction * a.config.name.localeCompare(b.config.name);
        });
        break;
      default:
        break;
    }

    return sorted;
  }, [configs, sortOption, sortDirection, usageByProvider, selectedModels]);

  const toggleModelSelection = (modelName: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelName)) {
        next.delete(modelName);
      } else {
        next.add(modelName);
      }
      return next;
    });
  };

  const clearAllModels = () => {
    setSelectedModels(new Set());
  };

  const selectFilteredModels = () => {
    setSelectedModels(new Set(filteredModelNames));
  };

  const handleSortOptionChange = (value: SortOption) => {
    setSortOption(value);
    if (value === 'recent-success' || value === 'total-success') {
      setSortDirection('desc');
    }
  };

  const toggleSortDirection = () => {
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  const toggleDropdown = () => setIsDropdownOpen((prev) => !prev);

  useEffect(() => {
    if (!isDropdownOpen) return;
    requestAnimationFrame(() => modelSearchInputRef.current?.focus());
  }, [isDropdownOpen]);

  const renderSortControls = () => (
    <div className={styles.sortControls}>
      <Select
        value={sortOption}
        options={sortOptions}
        onChange={(value) => handleSortOptionChange(value as SortOption)}
        className={styles.sortSelect}
        disabled={actionsDisabled}
        ariaLabel={t('ai_providers.sort_label')}
        fullWidth={false}
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={toggleSortDirection}
        className={styles.sortDirectionButton}
        disabled={actionsDisabled || sortOption === 'config-order'}
        title={
          sortDirection === 'asc'
            ? t('ai_providers.sort_ascending')
            : t('ai_providers.sort_descending')
        }
        aria-label={
          sortDirection === 'asc'
            ? t('ai_providers.sort_ascending')
            : t('ai_providers.sort_descending')
        }
      >
        <span className={styles.sortDirectionIcon}>
          {sortDirection === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </span>
        <span>
          {sortDirection === 'asc'
            ? t('ai_providers.sort_asc_short')
            : t('ai_providers.sort_desc_short')}
        </span>
      </Button>
    </div>
  );

  const renderToolbar = (isFloating = false) => {
    const isActiveToolbar = isFloating === shouldRenderFloatingToolbar;
    const dropdownClassName = dropdownLayout.openAbove
      ? `${styles.modelDropdownList} ${styles.modelDropdownListAbove}`
      : styles.modelDropdownList;

    return (
      <div className={styles.cardHeaderActions}>
        <div
          className={styles.modelMultiSelectWrapper}
          ref={isFloating ? floatingDropdownRef : topDropdownRef}
        >
          <div
            className={[
              styles.modelFilterControl,
              modelFilterActive ? styles.modelFilterControlActive : '',
              actionsDisabled ? styles.modelFilterControlDisabled : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <button
              type="button"
              className={styles.modelFilterTrigger}
              onClick={toggleDropdown}
              disabled={actionsDisabled}
              title={modelFilterTitle}
              aria-label={modelFilterTitle}
              aria-haspopup="true"
              aria-expanded={isActiveToolbar && isDropdownOpen}
            >
              <span className={styles.modelFilterIcon} aria-hidden="true">
                <IconSlidersHorizontal size={14} />
              </span>
              <span className={styles.modelFilterText}>{modelFilterLabel}</span>
              {modelFilterActive && (
                <span className={styles.modelFilterCount}>{selectedModelNames.length}</span>
              )}
              <span className={styles.modelFilterChevron} aria-hidden="true">
                <IconChevronDown size={14} />
              </span>
            </button>
            {modelFilterActive && (
              <button
                type="button"
                className={styles.modelFilterInlineClear}
                onClick={clearAllModels}
                disabled={actionsDisabled}
                aria-label={t('ai_providers.model_search_clear')}
                title={t('ai_providers.model_search_clear')}
              >
                <IconX size={14} />
              </button>
            )}
          </div>

          {isActiveToolbar && isDropdownOpen && (
            <div
              className={dropdownClassName}
              style={{ maxHeight: `${dropdownLayout.maxHeight}px` }}
            >
              <div className={styles.modelDropdownHeader}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={selectFilteredModels}
                  className={styles.modelDropdownSelectAll}
                  disabled={actionsDisabled || filteredModelNames.length === 0}
                >
                  {t('ai_providers.model_select_all')}
                </Button>
                {modelFilterActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllModels}
                    className={styles.modelDropdownClear}
                    disabled={actionsDisabled}
                  >
                    {t('ai_providers.model_search_clear')}
                  </Button>
                )}
              </div>
              <div className={styles.modelDropdownSearch}>
                <input
                  ref={modelSearchInputRef}
                  type="text"
                  value={modelFilterSearch}
                  onChange={(event) => setModelFilterSearch(event.target.value)}
                  className={styles.modelDropdownSearchInput}
                  placeholder={t('ai_providers.model_search_placeholder')}
                  disabled={actionsDisabled}
                />
                {modelFilterSearch.trim() && (
                  <button
                    type="button"
                    className={styles.modelDropdownSearchClear}
                    onClick={() => setModelFilterSearch('')}
                    disabled={actionsDisabled}
                    aria-label={t('ai_providers.model_search_clear')}
                    title={t('ai_providers.model_search_clear')}
                  >
                    <IconX size={14} />
                  </button>
                )}
              </div>
              <div
                className={styles.modelDropdownItems}
                role="group"
                aria-label={t('ai_providers.model_search_placeholder')}
              >
                {filteredModelNames.length === 0 ? (
                  <div className={styles.modelDropdownEmpty}>
                    {t('ai_providers.model_filter_empty')}
                  </div>
                ) : (
                  filteredModelNames.map((name) => (
                    <SelectionCheckbox
                      key={`top-option-${name}`}
                      checked={selectedModels.has(name)}
                      onChange={() => toggleModelSelection(name)}
                      disabled={actionsDisabled}
                      className={styles.modelDropdownItem}
                      labelClassName={styles.modelDropdownItemLabel}
                      label={<span title={name}>{name}</span>}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        {renderSortControls()}
        <Button
          size="sm"
          onClick={onAdd}
          disabled={actionsDisabled}
          className={styles.openaiAddButton}
        >
          {t('ai_providers.openai_add_button')}
        </Button>
      </div>
    );
  };

  const renderStaticTitle = () => (
    <span className={styles.cardTitle}>
      <img
        src={resolvedTheme === 'dark' ? iconOpenaiDark : iconOpenaiLight}
        alt=""
        className={styles.cardTitleIcon}
      />
      {t('ai_providers.openai_title')}
    </span>
  );

  const renderProviderCard = ({ config: provider, originalIndex }: IndexedOpenAIProvider) => {
    const stats = getOpenAIProviderTotalStats(provider, usageByProvider);
    const headerEntries = Object.entries(provider.headers || {});
    const userAgentHeader = headerEntries.find(([key]) => key.toLowerCase() === 'user-agent');
    const visibleHeaderEntries = headerEntries.filter(([key]) => key.toLowerCase() !== 'user-agent');
    const apiKeyEntries = provider.apiKeyEntries || [];
    const statusData =
      statusBarCache.get(getOpenAIProviderKey(provider, originalIndex)) || EMPTY_STATUS_BAR;
    const providerDisabled = provider.disabled === true;
    const testResult = testResults[originalIndex];
    const hasSuccessDetails = Boolean(testResult?.successResponseBodyText);
    const hasFailureDetails = Boolean(testResult?.failureResponseBodyText);
    const hasSummaryDetails = Boolean(
      testResult?.responseBodyText || testResult?.message || testResult?.responseStatusCode
    );

    return (
      <div
        key={`openai-provider-${originalIndex}`}
        className={styles.openaiProviderCard}
        style={actionsDisabled ? { opacity: 0.6 } : undefined}
      >
        <div className={styles.openaiProviderMeta}>
          <div className={styles.providerCardTopBar}>
            <div className={styles.openaiProviderTitle}>
              <span title={provider.name}>{provider.name}</span>
              {provider.priority !== undefined && (
                <span
                  className={styles.openaiProviderPriority}
                  title={`${t('common.priority')}: ${provider.priority}`}
                >
                  {provider.priority}
                </span>
              )}
              {userAgentHeader && (
                <span
                  className={styles.openaiHeaderInfoIcon}
                  title={`${userAgentHeader[0]}: ${userAgentHeader[1]}`}
                  aria-label={`${userAgentHeader[0]}: ${userAgentHeader[1]}`}
                  tabIndex={0}
                >
                  <IconInfo size={13} />
                </span>
              )}
            </div>
            <div className={styles.openaiProviderTopActions}>
              <Button
                variant="secondary"
                size="sm"
                className={styles.openaiProviderIconButton}
                onClick={() => onTest(originalIndex)}
                loading={testResult?.status === 'loading'}
                disabled={actionsDisabled || !apiKeyEntries.some((entry) => entry.apiKey?.trim())}
                aria-label={t('ai_providers.openai_test_single_action')}
                title={t('ai_providers.openai_test_single_action')}
              >
                <IconPlay size={15} />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className={styles.openaiProviderIconButton}
                onClick={() => onEdit(originalIndex)}
                disabled={actionsDisabled}
                aria-label={t('common.edit')}
                title={t('common.edit')}
              >
                <IconPencil size={15} />
              </Button>
              <Button
                variant="danger"
                size="sm"
                className={styles.openaiProviderIconButton}
                onClick={() => onDelete(originalIndex)}
                disabled={actionsDisabled}
                aria-label={t('common.delete')}
                title={t('common.delete')}
              >
                <IconTrash2 size={15} />
              </Button>
              <span className={styles.openaiProviderToggleAction} title={t('ai_providers.config_toggle_label')}>
                <ToggleSwitch
                  ariaLabel={t('ai_providers.config_toggle_label')}
                  checked={!providerDisabled}
                  disabled={toggleDisabled}
                  onChange={(value) => void onToggle(originalIndex, value)}
                />
              </span>
            </div>
          </div>
          {testResult?.message && (
            <div className={styles.openaiTestResultGroup}>
              {testResult.successMessage && (
                <button
                  type="button"
                  className={`status-badge success ${styles.testResultStatusButton}`}
                  disabled={!hasSuccessDetails}
                  onClick={() => {
                    if (!hasSuccessDetails) return;
                    onOpenTestResult(originalIndex, 'success');
                  }}
                  title={t('ai_providers.openai_test_response_toggle', {
                    defaultValue: 'View test response',
                  })}
                  aria-label={t('ai_providers.openai_test_response_toggle', {
                    defaultValue: 'View test response',
                  })}
                >
                  {testResult.successMessage}
                </button>
              )}
              {testResult.failureMessage && (
                <button
                  type="button"
                  className={`status-badge error ${styles.testResultStatusButton}`}
                  disabled={!hasFailureDetails}
                  onClick={() => {
                    if (!hasFailureDetails) return;
                    onOpenTestResult(originalIndex, 'failure');
                  }}
                  title={t('ai_providers.openai_test_response_toggle', {
                    defaultValue: 'View test response',
                  })}
                  aria-label={t('ai_providers.openai_test_response_toggle', {
                    defaultValue: 'View test response',
                  })}
                >
                  {testResult.failureMessage}
                </button>
              )}
              {!testResult.successMessage && !testResult.failureMessage && (
                <button
                  type="button"
                  className={`status-badge ${
                    testResult.status === 'error'
                      ? 'error'
                      : testResult.status === 'success'
                        ? 'success'
                        : 'muted'
                  } ${styles.testResultStatusButton}`}
                  disabled={!hasSummaryDetails}
                  onClick={() => {
                    if (!hasSummaryDetails) return;
                    onOpenTestResult(originalIndex);
                  }}
                  title={t('ai_providers.openai_test_response_toggle', {
                    defaultValue: 'View test response',
                  })}
                  aria-label={t('ai_providers.openai_test_response_toggle', {
                    defaultValue: 'View test response',
                  })}
                >
                  {testResult.message}
                </button>
              )}
            </div>
          )}
          {provider.prefix && (
            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>{t('common.prefix')}:</span>
              <span className={styles.fieldValue}>{provider.prefix}</span>
            </div>
          )}
          <div className={`${styles.fieldRow} ${styles.openaiProviderUrlRow}`}>
            <span className={`${styles.fieldValue} ${styles.openaiProviderUrl}`} title={provider.baseUrl}>
              {provider.baseUrl}
            </span>
          </div>
          {providerDisabled && (
            <div className="status-badge warning" style={{ marginTop: 8, marginBottom: 0 }}>
              {t('ai_providers.config_disabled_badge')}
            </div>
          )}
          {visibleHeaderEntries.length > 0 && (
            <div className={styles.headerBadgeList}>
              {visibleHeaderEntries.map(([key, value]) => (
                <span key={key} className={styles.headerBadge}>
                  <strong>{key}:</strong> {value}
                </span>
              ))}
            </div>
          )}
          <div className={styles.openaiProviderResourceGrid}>
            {apiKeyEntries.length > 0 && (
              <div className={styles.apiKeyEntriesSection}>
                <button
                  type="button"
                  className={styles.apiKeyEntriesSummary}
                  onClick={() => setKeyModalProvider({ config: provider, originalIndex })}
                >
                  <span className={styles.apiKeyEntriesLabel}>
                    {t('ai_providers.openai_keys_count')}: {apiKeyEntries.length}
                  </span>
                  <span className={styles.apiKeyEntriesSummaryAction}>
                    <IconEye size={14} />
                  </span>
                </button>
              </div>
            )}
            {provider.models?.length ? (
              <div className={styles.modelEntriesSection}>
                <div className={styles.modelEntriesSummary} tabIndex={0}>
                  <span className={styles.modelEntriesLabel}>
                    {t('ai_providers.openai_models_count')}: {provider.models.length}
                  </span>
                  <span className={styles.modelEntriesSummaryAction}>
                    <IconModelCluster size={14} />
                  </span>
                  <div className={styles.modelEntriesHoverPanel}>
                    <div className={styles.modelTagList}>
                      {provider.models.map((model) => (
                        <span key={model.name} className={styles.modelTag}>
                          <span className={styles.modelName}>{model.name}</span>
                          {model.alias && model.alias !== model.name && (
                            <span className={styles.modelAlias}>{model.alias}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className={styles.openaiProviderResourceEmpty}>
                <span className={styles.modelEntriesLabel}>
                  {t('ai_providers.openai_models_count')}: 0
                </span>
              </div>
            )}
          </div>
          {provider.testModel && (
            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>{t('ai_providers.openai_test_model')}:</span>
              <span className={styles.fieldValue}>{provider.testModel}</span>
            </div>
          )}
          <div className={styles.openaiProviderHealthRow}>
            <div className={styles.cardStats}>
              <span
                className={`${styles.statPill} ${styles.statSuccess}`}
                title={`${t('stats.success')}: ${stats.success}`}
              >
                {stats.success}
              </span>
              <span
                className={`${styles.statPill} ${styles.statFailure}`}
                title={`${t('stats.failure')}: ${stats.failure}`}
              >
                {stats.failure}
              </span>
            </div>
            <ProviderStatusBar statusData={statusData} />
          </div>
        </div>
      </div>
    );
  };

  const keyModalEntries = keyModalProvider?.config.apiKeyEntries || [];

  return (
    <>
      <div ref={sectionRef}>
        <Card
          title={toolbarPortalTarget ? undefined : renderStaticTitle()}
          extra={
            toolbarPortalTarget ? undefined : (
              <div
                ref={topToolbarAnchorRef}
                className={shouldRenderFloatingToolbar ? styles.openaiToolbarAnchorHidden : undefined}
              >
                {renderToolbar(false)}
              </div>
            )
          }
        >
          {loading && sortedConfigs.length === 0 ? (
            <div className="hint">{t('common.loading')}</div>
          ) : configs.length > 0 && sortedConfigs.length === 0 ? (
            <EmptyState
              title={t('ai_providers.openai_filtered_empty_title')}
              description={t('ai_providers.openai_filtered_empty_desc')}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={clearAllModels}
                  disabled={actionsDisabled}
                >
                  {t('ai_providers.model_search_clear')}
                </Button>
              }
            />
          ) : sortedConfigs.length === 0 ? (
            <EmptyState
              title={t('ai_providers.openai_empty_title')}
              description={t('ai_providers.openai_empty_desc')}
            />
          ) : (
            <div className={styles.openaiProviderList}>{sortedConfigs.map(renderProviderCard)}</div>
          )}
        </Card>
      </div>
      {toolbarPortalTarget ? createPortal(renderToolbar(false), toolbarPortalTarget) : null}
      {typeof document !== 'undefined' && shouldRenderFloatingToolbar
        ? createPortal(
            <div
              className={`card ${styles.openaiFloatingToolbar}`}
              style={{
                left: `${floatingToolbarStyle.left}px`,
                top: `${floatingToolbarStyle.top}px`,
                width: `${floatingToolbarStyle.width}px`,
              }}
            >
              <div className="card-header">
                <div className="title">{renderStaticTitle()}</div>
                {renderToolbar(true)}
              </div>
            </div>,
            document.body
          )
        : null}
      <Modal
        open={keyModalProvider !== null}
        title={
          keyModalProvider
            ? t('ai_providers.openai_keys_modal_title', {
                name: keyModalProvider.config.name,
              })
            : undefined
        }
        width={680}
        onClose={() => setKeyModalProvider(null)}
        footer={
          <Button variant="secondary" onClick={() => setKeyModalProvider(null)}>
            {t('common.close')}
          </Button>
        }
      >
        {keyModalProvider && (
          <div className={styles.apiKeyEntriesModalBody}>
            <div className={styles.apiKeyEntriesModalMeta}>
              {t('ai_providers.openai_keys_count')}: {keyModalEntries.length}
            </div>
            <div className={styles.apiKeyEntryList}>
              {keyModalEntries.map((entry, entryIndex) => {
                const entryStats = getProviderTotalStats(
                  usageByProvider,
                  keyModalProvider.config.name,
                  entry.apiKey,
                  keyModalProvider.config.baseUrl
                );
                const shouldWarnKey = entryStats.success === 0 && entryStats.failure >= 3;
                return (
                  <div
                    key={getApiKeyEntryRenderKey(entry, entryIndex)}
                    className={`${styles.apiKeyEntryCard} ${
                      shouldWarnKey ? styles.apiKeyEntryCardWarning : ''
                    }`}
                  >
                    <span className={styles.apiKeyEntryIndex}>{entryIndex + 1}</span>
                    <span className={styles.apiKeyEntryKey}>{maskApiKey(entry.apiKey)}</span>
                    {entry.proxyUrl && (
                      <span className={styles.apiKeyEntryProxy}>{entry.proxyUrl}</span>
                    )}
                    <div className={styles.apiKeyEntryStats}>
                      <span
                        className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatSuccess}`}
                      >
                        <IconCheck size={12} /> {entryStats.success}
                      </span>
                      <span
                        className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatFailure}`}
                      >
                        <IconX size={12} /> {entryStats.failure}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
