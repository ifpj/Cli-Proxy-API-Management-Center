import { useTranslation } from 'react-i18next';
import { AvailableModelsPanel } from '@/components/models/AvailableModelsPanel';
import styles from './SystemPage.module.scss';

export function ModelsPage() {
  const { t } = useTranslation();

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('system_info.models_title')}</h1>
      <div className={styles.content}>
        <AvailableModelsPanel />
      </div>
    </div>
  );
}
