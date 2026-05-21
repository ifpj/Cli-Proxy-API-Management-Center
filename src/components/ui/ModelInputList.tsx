import { Fragment, useState } from 'react';
import { Button } from './Button';
import { IconGripVertical, IconX } from './icons';
import type { ModelEntry } from './modelInputListUtils';

interface ModelInputListProps {
  entries: ModelEntry[];
  onChange: (entries: ModelEntry[]) => void;
  addLabel?: string;
  disabled?: boolean;
  namePlaceholder?: string;
  aliasPlaceholder?: string;
  hideAddButton?: boolean;
  onAdd?: () => void;
  className?: string;
  rowClassName?: string;
  inputClassName?: string;
  removeButtonClassName?: string;
  removeButtonTitle?: string;
  removeButtonAriaLabel?: string;
  enableReorder?: boolean;
  dragHandleClassName?: string;
  draggingRowClassName?: string;
  dragOverRowClassName?: string;
  reorderButtonTitle?: string;
  reorderButtonAriaLabel?: string;
}

export function ModelInputList({
  entries,
  onChange,
  addLabel,
  disabled = false,
  namePlaceholder = 'model-name',
  aliasPlaceholder = 'alias (optional)',
  hideAddButton = false,
  onAdd,
  className = '',
  rowClassName = '',
  inputClassName = '',
  removeButtonClassName = '',
  removeButtonTitle = 'Remove',
  removeButtonAriaLabel = 'Remove',
  enableReorder = false,
  dragHandleClassName = '',
  draggingRowClassName = '',
  dragOverRowClassName = '',
  reorderButtonTitle = 'Drag to reorder',
  reorderButtonAriaLabel = 'Drag to reorder',
}: ModelInputListProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const currentEntries = entries.length ? entries : [{ name: '', alias: '' }];
  const containerClassName = ['header-input-list', className].filter(Boolean).join(' ');
  const inputClassNames = ['input', inputClassName].filter(Boolean).join(' ');
  const canReorder = enableReorder && !disabled && currentEntries.length > 1;

  const getRowClassNames = (index: number) =>
    [
      'header-input-row',
      rowClassName,
      draggedIndex === index ? draggingRowClassName : '',
      dragOverIndex === index && draggedIndex !== index ? dragOverRowClassName : '',
    ]
      .filter(Boolean)
      .join(' ');

  const updateEntry = (index: number, field: 'name' | 'alias', value: string) => {
    const next = currentEntries.map((entry, idx) =>
      idx === index ? { ...entry, [field]: value } : entry
    );
    onChange(next);
  };

  const addEntry = () => {
    if (onAdd) {
      onAdd();
    } else {
      onChange([...currentEntries, { name: '', alias: '' }]);
    }
  };

  const removeEntry = (index: number) => {
    const next = currentEntries.filter((_, idx) => idx !== index);
    onChange(next.length ? next : [{ name: '', alias: '' }]);
  };

  const finishDrag = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const moveEntry = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const next = [...currentEntries];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onChange(next);
  };

  return (
    <div className={containerClassName}>
      {currentEntries.map((entry, index) => (
        <Fragment key={index}>
          <div
            className={getRowClassNames(index)}
            onDragOver={(event) => {
              if (!canReorder || draggedIndex === null) return;
              event.preventDefault();
              setDragOverIndex(index);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (!canReorder || draggedIndex === null) {
                finishDrag();
                return;
              }
              moveEntry(draggedIndex, index);
              finishDrag();
            }}
          >
            {enableReorder && (
              <button
                type="button"
                className={dragHandleClassName}
                draggable={canReorder}
                disabled={!canReorder}
                title={reorderButtonTitle}
                aria-label={reorderButtonAriaLabel}
                onDragStart={(event) => {
                  if (!canReorder) return;
                  setDraggedIndex(index);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(index));
                }}
                onDragEnd={finishDrag}
              >
                <IconGripVertical size={16} />
              </button>
            )}
            <input
              className={inputClassNames}
              placeholder={namePlaceholder}
              value={entry.name}
              onChange={(e) => updateEntry(index, 'name', e.target.value)}
              disabled={disabled}
            />
            <span className="header-separator">→</span>
            <input
              className={inputClassNames}
              placeholder={aliasPlaceholder}
              value={entry.alias}
              onChange={(e) => updateEntry(index, 'alias', e.target.value)}
              disabled={disabled}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeEntry(index)}
              disabled={disabled || currentEntries.length <= 1}
              className={removeButtonClassName}
              title={removeButtonTitle}
              aria-label={removeButtonAriaLabel}
            >
              <IconX size={14} />
            </Button>
          </div>
        </Fragment>
      ))}
      {!hideAddButton && addLabel && (
        <Button
          variant="secondary"
          size="sm"
          onClick={addEntry}
          disabled={disabled}
          className="align-start"
        >
          {addLabel}
        </Button>
      )}
    </div>
  );
}
