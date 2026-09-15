import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export type SelectOption = {
  value: string;
  label?: string;
  disabled?: boolean;
};

export default function SelectMenu({
  id,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  ariaLabel,
  ariaInvalid = false,
  className = '',
}: {
  id?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  ariaInvalid?: boolean;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const enabledIndexes = options
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => !option.disabled)
    .map(({ index }) => index);

  function moveActive(direction: 1 | -1) {
    if (!enabledIndexes.length) return;

    const current = activeIndex >= 0
      ? enabledIndexes.indexOf(activeIndex)
      : selectedIndex >= 0
        ? enabledIndexes.indexOf(selectedIndex)
        : -1;

    const next = current < 0
      ? (direction > 0 ? 0 : enabledIndexes.length - 1)
      : (current + direction + enabledIndexes.length) % enabledIndexes.length;

    setActiveIndex(enabledIndexes[next]);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    setActiveIndex(index);
  }

  function handleButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : enabledIndexes[0] ?? -1);
      } else {
        moveActive(event.key === 'ArrowDown' ? 1 : -1);
      }
      return;
    }

    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      if (activeIndex >= 0) choose(activeIndex);
      return;
    }

    if (event.key === 'Home' && open) {
      event.preventDefault();
      setActiveIndex(enabledIndexes[0] ?? -1);
      return;
    }

    if (event.key === 'End' && open) {
      event.preventDefault();
      setActiveIndex(enabledIndexes[enabledIndexes.length - 1] ?? -1);
    }
  }

  return (
    <div
      className={`select-menu ${className}`}
      ref={rootRef}
    >
      <button
        id={id}
        type="button"
        className="select-menu-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || undefined}
        onClick={() => {
          setOpen((current) => {
            const next = !current;
            if (next) setActiveIndex(selectedIndex >= 0 ? selectedIndex : enabledIndexes[0] ?? -1);
            return next;
          });
        }}
        onKeyDown={handleButtonKeyDown}
      >
        <span className={selected ? '' : 'select-menu-placeholder'}>
          {selected?.label ?? selected?.value ?? placeholder}
        </span>
        <span className="select-menu-chevron" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div
          className="select-menu-list"
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              key={`${option.value}-${index}`}
              className={[
                'select-menu-option',
                option.value === value ? 'selected' : '',
                index === activeIndex ? 'active' : '',
              ].filter(Boolean).join(' ')}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              {option.label ?? option.value}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
