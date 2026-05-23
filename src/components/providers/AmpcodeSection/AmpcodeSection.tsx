import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconModelCluster, IconPencil } from '@/components/ui/icons';
import iconAmp from '@/assets/icons/amp.svg';
import type { AmpcodeConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import styles from '@/pages/AiProvidersPage.module.scss';
import { useTranslation } from 'react-i18next';

interface AmpcodeSectionProps {
  config: AmpcodeConfig | null | undefined;
  loading: boolean;
  disableControls: boolean;
  isSwitching: boolean;
  onEdit: () => void;
}

export function AmpcodeSection({
  config,
  loading,
  disableControls,
  isSwitching,
  onEdit,
}: AmpcodeSectionProps) {
  const { t } = useTranslation();
  const showLoadingPlaceholder = loading && !config;
  const upstreamKeyCount = (config?.upstreamApiKey ? 1 : 0) + (config?.upstreamApiKeys?.length || 0);

  return (
    <Card
      title={
        <span className={styles.cardTitle}>
          <img src={iconAmp} alt="" className={styles.cardTitleIcon} />
          {t('ai_providers.ampcode_title')}
        </span>
      }
    >
      {showLoadingPlaceholder ? (
        <div className="hint">{t('common.loading')}</div>
      ) : (
        <div className={styles.openaiProviderList}>
          <div className={styles.openaiProviderCard}>
            <div className={styles.openaiProviderMeta}>
              <div className={styles.providerCardTopBar}>
                <div className={styles.openaiProviderTitle}>
                  <span title={t('ai_providers.ampcode_title')}>
                    {t('ai_providers.ampcode_title')}
                  </span>
                </div>
                <div className={styles.openaiProviderTopActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    className={styles.openaiProviderIconButton}
                    onClick={onEdit}
                    disabled={disableControls || loading || isSwitching}
                    aria-label={t('common.edit')}
                    title={t('common.edit')}
                  >
                    <IconPencil size={15} />
                  </Button>
                </div>
              </div>

              <div className={`${styles.fieldRow} ${styles.openaiProviderUrlRow}`}>
                <span
                  className={`${styles.fieldValue} ${styles.openaiProviderUrl}`}
                  title={config?.upstreamUrl || t('common.not_set')}
                >
                  {config?.upstreamUrl || t('common.not_set')}
                </span>
              </div>

              <div className={styles.openaiProviderResourceGrid}>
                <div className={styles.apiKeyEntriesSection}>
                  <div
                    className={styles.apiKeyEntriesSummary}
                    title={
                      config?.upstreamApiKey
                        ? maskApiKey(config.upstreamApiKey)
                        : t('common.not_set')
                    }
                  >
                    <span className={styles.apiKeyEntriesLabel}>
                      {t('ai_providers.ampcode_upstream_api_keys_count')}: {upstreamKeyCount}
                    </span>
                  </div>
                </div>

                <div className={styles.modelEntriesSection}>
                  <div className={styles.modelEntriesSummary} tabIndex={0}>
                    <span className={styles.modelEntriesLabel}>
                      {t('ai_providers.ampcode_model_mappings_count')}:{' '}
                      {config?.modelMappings?.length || 0}
                    </span>
                    <span className={styles.modelEntriesSummaryAction}>
                      <IconModelCluster size={14} />
                    </span>
                    {config?.modelMappings?.length ? (
                      <div className={styles.modelEntriesHoverPanel}>
                        <div className={styles.modelTagList}>
                          {config.modelMappings.map((mapping) => (
                            <span key={`${mapping.from}->${mapping.to}`} className={styles.modelTag}>
                              <span className={styles.modelName}>{mapping.from}</span>
                              <span className={styles.modelAlias}>{mapping.to}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>
                  {t('ai_providers.ampcode_force_model_mappings_label')}:
                </span>
                <span className={styles.fieldValue}>
                  {(config?.forceModelMappings ?? false) ? t('common.yes') : t('common.no')}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
